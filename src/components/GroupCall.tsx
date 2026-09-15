'use client'

import { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react'
import type { Socket } from 'socket.io-client'

interface GroupCallProps {
  socket: Socket | null
  roomId: string
  userName: string
  userId: string
  hideStartButton?: boolean
}

export interface GroupCallRef {
  startCall: () => void
  joinCall: () => void
}

interface PeerConnection {
  connection: RTCPeerConnection
  stream?: MediaStream
}

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
  ],
  // Optimizations for 2G/low bandwidth networks
  iceCandidatePoolSize: 10, // Pre-gather ICE candidates for faster connections
  bundlePolicy: 'max-bundle', // Bundle all media on single transport (saves bandwidth)
  rtcpMuxPolicy: 'require', // Multiplex RTP and RTCP on same port (NAT-friendly)
  iceTransportPolicy: 'all', // Allow both STUN and relay candidates
}

const GroupCall = forwardRef<GroupCallRef, GroupCallProps>(({ socket, roomId, userName, userId, hideStartButton = false }, ref) => {
  const [isCallActive, setIsCallActive] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [isSpeakerOn, setIsSpeakerOn] = useState(false)
  const [participants, setParticipants] = useState<Map<string, { name: string; socketId: string; stream?: MediaStream }>>(new Map())
  const [isInitiator, setIsInitiator] = useState(false)
  
  const localStreamRef = useRef<MediaStream | null>(null)
  const peerConnectionsRef = useRef<Map<string, PeerConnection>>(new Map())
  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map())
  const hasRestoredRef = useRef(false)
  const retryAudioPlaybackRef = useRef<(() => void) | null>(null)
  const activeAudioOutputDeviceRef = useRef<string | null>(null) // Track current output device

  // Helper: Set audio output device to the currently active device (Bluetooth headset or default)
  // CRITICAL for Bluetooth headset support - must be called before audio.play()
  const setAudioOutputDevice = useCallback(async (audioElement: HTMLAudioElement) => {
    // iOS Safari doesn't support setSinkId - audio routing is controlled by iOS system
    if (!('setSinkId' in audioElement)) {
      console.log('[Audio] setSinkId not supported (likely iOS), using system default')
      return
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      const audioOutputs = devices.filter(d => d.kind === 'audiooutput')
      
      console.log('[Audio] Available output devices:', audioOutputs.map(d => `${d.label} (${d.deviceId})`).join(', '))

      // Priority order for device selection:
      // 1. Use activeAudioOutputDeviceRef if already set (user preference or previously detected)
      // 2. Detect Bluetooth device (label contains 'bluetooth', 'airpods', 'headset', 'wireless')
      // 3. Use 'communications' device if available (Windows default for calls)
      // 4. Fallback to 'default' device
      
      let targetDevice: MediaDeviceInfo | undefined

      // If we already have an active device set, use it
      if (activeAudioOutputDeviceRef.current) {
        targetDevice = audioOutputs.find(d => d.deviceId === activeAudioOutputDeviceRef.current)
        if (targetDevice) {
          console.log('[Audio] Using previously selected device:', targetDevice.label)
        }
      }

      // If no active device, detect the best available device
      if (!targetDevice) {
        // Try to find Bluetooth/wireless device
        targetDevice = audioOutputs.find(d => {
          const label = d.label.toLowerCase()
          return label.includes('bluetooth') || 
                 label.includes('airpods') || 
                 label.includes('headset') || 
                 label.includes('wireless') ||
                 label.includes('headphone')
        })

        if (targetDevice) {
          console.log('[Audio] Detected Bluetooth/wireless device:', targetDevice.label)
          activeAudioOutputDeviceRef.current = targetDevice.deviceId
        }
      }

      // If no Bluetooth, try 'communications' device (Windows)
      if (!targetDevice) {
        targetDevice = audioOutputs.find(d => d.deviceId === 'communications')
        if (targetDevice) {
          console.log('[Audio] Using communications device:', targetDevice.label)
          activeAudioOutputDeviceRef.current = targetDevice.deviceId
        }
      }

      // Fallback to 'default' device
      if (!targetDevice) {
        targetDevice = audioOutputs.find(d => d.deviceId === 'default')
        if (targetDevice) {
          console.log('[Audio] Using default device:', targetDevice.label)
          activeAudioOutputDeviceRef.current = targetDevice.deviceId
        }
      }

      // Apply the selected device
      if (targetDevice) {
        await (audioElement as any).setSinkId(targetDevice.deviceId)
        console.log('[Audio] Successfully set output device to:', targetDevice.label)
      } else {
        console.warn('[Audio] No suitable output device found, using browser default')
      }
    } catch (err) {
      console.error('[Audio] Failed to set output device:', err)
      // Non-fatal - browser will use default device
    }
  }, [])

  // Cleanup function for ending the call
  const cleanup = useCallback(() => {
    // Stop local stream
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop())
      localStreamRef.current = null
    }

    // Close all peer connections
    peerConnectionsRef.current.forEach(({ connection }) => {
      connection.close()
    })
    peerConnectionsRef.current.clear()

    // Stop all audio elements
    audioElementsRef.current.forEach(audio => {
      audio.pause()
      audio.srcObject = null
      audio.remove()
    })
    audioElementsRef.current.clear()

    setParticipants(new Map())
    setIsCallActive(false)
    setIsInitiator(false)
    
    // Clear persisted call state from localStorage
    try {
      localStorage.removeItem(`active-call-${roomId}`)
    } catch (err) {
      console.warn('Failed to clear call state from localStorage:', err)
    }
  }, [roomId])

  // Create peer connection for a specific user
  const createPeerConnection = useCallback((peerId: string, peerName: string): RTCPeerConnection => {
    const pc = new RTCPeerConnection(ICE_SERVERS)

    // Add local stream tracks to the connection with bandwidth constraints for 2G
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        const sender = pc.addTrack(track, localStreamRef.current!)
        
        // Apply bandwidth constraints for 2G networks (max 32kbps for audio)
        if (track.kind === 'audio') {
          const params = sender.getParameters()
          if (!params.encodings) {
            params.encodings = [{}]
          }
          params.encodings[0].maxBitrate = 32000 // 32 kbps max for audio (good for 2G)
          sender.setParameters(params).catch(err => 
            console.warn('Failed to set bandwidth constraints:', err)
          )
        }
      })
    }

    // Handle incoming remote stream
    pc.ontrack = (event) => {
      const [remoteStream] = event.streams
      if (remoteStream) {
        // Update participant with stream
        setParticipants(prev => {
          const updated = new Map(prev)
          const existing = updated.get(peerId)
          if (existing) {
            updated.set(peerId, { ...existing, stream: remoteStream })
          } else {
            // If not in participants yet, use peerId as socketId (it should be socketId)
            updated.set(peerId, { name: peerName, socketId: peerId, stream: remoteStream })
          }
          return updated
        })

        // Create or update audio element optimized for mobile devices
        let audio = audioElementsRef.current.get(peerId)
        if (!audio) {
          audio = new Audio()
          audio.autoplay = true
          
          // Mobile-first audio configuration
          // Set attributes for better mobile compatibility
          audio.setAttribute('playsinline', 'true')
          audio.setAttribute('webkit-playsinline', 'true')
          
          // Default volume for earpiece mode (mobile optimization)
          audio.volume = 0.85
          
          // Attach to DOM (hidden) - mobile browsers (notably iOS Safari) need the
          // element in the document to reliably route WebRTC remote audio to the speaker
          audio.style.display = 'none'
          document.body.appendChild(audio)
          
          audioElementsRef.current.set(peerId, audio)
          
          // CRITICAL FIX: Set audio output device to active device (Bluetooth/default)
          // This must happen BEFORE setting srcObject to ensure proper routing
          setAudioOutputDevice(audio).catch(err => 
            console.warn('Failed to set audio output device on new element:', err)
          )
        }
        audio.srcObject = remoteStream
        
        // Play with user interaction handling for mobile browsers
        audio.play().catch(err => {
          console.error('Audio autoplay error:', err)
          // On mobile, play() triggered from an async signaling callback (not a direct
          // user gesture) is often blocked. Set up persistent retry mechanism.
          const retryPlayback = () => {
            audioElementsRef.current.forEach(audioEl => {
              if (audioEl.paused && audioEl.srcObject) {
                audioEl.play().catch(() => {})
              }
            })
          }
          
          // Store the retry function so it can be called from user interactions
          retryAudioPlaybackRef.current = retryPlayback
          
          // Also add one-time listeners as fallback
          document.addEventListener('click', retryPlayback, { once: true })
          document.addEventListener('touchend', retryPlayback, { once: true })
        })
      }
    }

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate && socket) {
        socket.emit('call:ice-candidate', {
          roomId,
          to: peerId,
          candidate: event.candidate,
        })
      }
    }

    // Handle connection state changes with reconnection for 2G networks
    pc.onconnectionstatechange = () => {
      console.log(`Peer ${peerId} connection state: ${pc.connectionState}`)
      
      if (pc.connectionState === 'failed') {
        console.log(`Peer ${peerId} connection failed, attempting ICE restart`)
        // Attempt ICE restart for failed connections (helps on unstable 2G)
        pc.restartIce()
      } else if (pc.connectionState === 'disconnected') {
        console.log(`Peer ${peerId} disconnected, waiting for reconnection...`)
        // Give it some time to reconnect before removing (2G networks often have brief dropouts)
        setTimeout(() => {
          if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
            console.log(`Peer ${peerId} still disconnected after timeout, removing`)
            peerConnectionsRef.current.delete(peerId)
            audioElementsRef.current.get(peerId)?.pause()
            audioElementsRef.current.get(peerId)?.remove()
            audioElementsRef.current.delete(peerId)
            setParticipants(prev => {
              const updated = new Map(prev)
              updated.delete(peerId)
              return updated
            })
          }
        }, 10000) // Wait 10 seconds for reconnection on slow networks
      }
    }

    peerConnectionsRef.current.set(peerId, { connection: pc })
    return pc
  }, [socket, roomId, setAudioOutputDevice])

  // Start the call
  const startCall = useCallback(async () => {
    if (!socket) return

    try {
      // CRITICAL FIX: Enumerate devices first to detect Bluetooth input
      const devices = await navigator.mediaDevices.enumerateDevices()
      const audioInputs = devices.filter(d => d.kind === 'audioinput')
      
      console.log('[Audio] Available input devices:', audioInputs.map(d => `${d.label} (${d.deviceId})`).join(', '))

      // Detect Bluetooth microphone (prioritize for better quality with Bluetooth headsets)
      const bluetoothMic = audioInputs.find(d => {
        const label = d.label.toLowerCase()
        return label.includes('bluetooth') || 
               label.includes('airpods') || 
               label.includes('headset') || 
               label.includes('wireless') ||
               label.includes('headphone')
      })

      // Get user audio with mobile-first optimizations
      // Optimized for mobile phone earpiece/speaker and low bandwidth networks
      const audioConstraints: MediaTrackConstraints = {
        // Essential audio processing for mobile phones
        echoCancellation: { ideal: true }, // Critical for earpiece/speaker feedback prevention
        noiseSuppression: { ideal: true }, // Critical for mobile environments (street, office)
        autoGainControl: { ideal: true }, // Normalize volume for better earpiece listening
        
        // Mobile & bandwidth optimizations
        sampleRate: { ideal: 16000 }, // 16kHz optimal for voice (earpiece quality)
        channelCount: { ideal: 1 }, // Mono - phones have single earpiece/speaker
        sampleSize: { ideal: 16 }, // 16-bit audio quality (good balance)
      }

      // CRITICAL: If Bluetooth device detected, use it explicitly
      if (bluetoothMic && bluetoothMic.deviceId) {
        audioConstraints.deviceId = { exact: bluetoothMic.deviceId }
        console.log('[Audio] Using Bluetooth microphone:', bluetoothMic.label)
      } else {
        console.log('[Audio] No Bluetooth mic detected, using default input')
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
        video: false,
      })

      localStreamRef.current = stream
      setIsCallActive(true)
      setIsInitiator(true)

      // Persist call state to localStorage for page refresh recovery
      try {
        localStorage.setItem(`active-call-${roomId}`, JSON.stringify({
          isActive: true,
          isInitiator: true,
          userId,
          userName,
          timestamp: Date.now()
        }))
      } catch (err) {
        console.warn('Failed to persist call state to localStorage:', err)
      }

      // Notify others that call has started
      socket.emit('call:start', { roomId, userName, userId })
    } catch (error) {
      console.error('Error accessing microphone:', error)
      alert('Could not access microphone. Please check permissions.')
    }
  }, [socket, roomId, userName, userId])

  // Join an existing call
  const joinCall = useCallback(async () => {
    if (!socket) return

    try {
      // CRITICAL FIX: Enumerate devices first to detect Bluetooth input
      const devices = await navigator.mediaDevices.enumerateDevices()
      const audioInputs = devices.filter(d => d.kind === 'audioinput')
      
      console.log('[Audio] Available input devices:', audioInputs.map(d => `${d.label} (${d.deviceId})`).join(', '))

      // Detect Bluetooth microphone (prioritize for better quality with Bluetooth headsets)
      const bluetoothMic = audioInputs.find(d => {
        const label = d.label.toLowerCase()
        return label.includes('bluetooth') || 
               label.includes('airpods') || 
               label.includes('headset') || 
               label.includes('wireless') ||
               label.includes('headphone')
      })

      const audioConstraints: MediaTrackConstraints = {
        // Essential audio processing for mobile phones
        echoCancellation: { ideal: true }, // Critical for earpiece/speaker feedback prevention
        noiseSuppression: { ideal: true }, // Critical for mobile environments (street, office)
        autoGainControl: { ideal: true }, // Normalize volume for better earpiece listening
        
        // Mobile & bandwidth optimizations
        sampleRate: { ideal: 16000 }, // 16kHz optimal for voice (earpiece quality)
        channelCount: { ideal: 1 }, // Mono - phones have single earpiece/speaker
        sampleSize: { ideal: 16 }, // 16-bit audio quality (good balance)
      }

      // CRITICAL: If Bluetooth device detected, use it explicitly
      if (bluetoothMic && bluetoothMic.deviceId) {
        audioConstraints.deviceId = { exact: bluetoothMic.deviceId }
        console.log('[Audio] Using Bluetooth microphone:', bluetoothMic.label)
      } else {
        console.log('[Audio] No Bluetooth mic detected, using default input')
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
        video: false,
      })

      localStreamRef.current = stream
      setIsCallActive(true)

      // Persist call state to localStorage for page refresh recovery
      try {
        localStorage.setItem(`active-call-${roomId}`, JSON.stringify({
          isActive: true,
          isInitiator: false,
          userId,
          userName,
          timestamp: Date.now()
        }))
      } catch (err) {
        console.warn('Failed to persist call state to localStorage:', err)
      }

      // Notify others that we're joining
      socket.emit('call:join', { roomId, userName, userId })
    } catch (error) {
      console.error('Error accessing microphone:', error)
      alert('Could not access microphone. Please check permissions.')
    }
  }, [socket, roomId, userName, userId])

  // End the call
  const endCall = useCallback(() => {
    if (!socket) return

    if (isInitiator) {
      // If initiator, end the call for everyone
      socket.emit('call:end', { roomId })
    } else {
      // If participant, just leave
      socket.emit('call:leave', { roomId, userId })
    }

    cleanup()
  }, [socket, roomId, userId, isInitiator, cleanup])

  // Toggle mute
  const toggleMute = useCallback(() => {
    // Retry audio playback on user interaction (fixes mobile autoplay issues)
    if (retryAudioPlaybackRef.current) {
      retryAudioPlaybackRef.current()
    }
    
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0]
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled
        setIsMuted(!audioTrack.enabled)
      }
    }
  }, [])

  // Toggle speaker mode - Mobile-first implementation
  const toggleSpeaker = useCallback(async () => {
    // Retry audio playback on user interaction (fixes mobile autoplay issues)
    if (retryAudioPlaybackRef.current) {
      retryAudioPlaybackRef.current()
    }
    
    setIsSpeakerOn(prev => {
      const newSpeakerState = !prev
      
      // Apply speaker mode to all audio elements
      audioElementsRef.current.forEach(async (audio) => {
        // Mobile-first approach: Use volume and audio context for speaker control
        // setSinkId has limited support on mobile browsers (especially iOS)
        
        if (newSpeakerState) {
          // SPEAKER MODE (Loudspeaker)
          audio.volume = 1.0 // Maximum volume for speakerphone
          
          // Try setSinkId only on desktop/supported browsers
          if ('setSinkId' in audio && typeof (audio as any).setSinkId === 'function') {
            // First, get available audio output devices
            navigator.mediaDevices.enumerateDevices()
              .then(devices => {
                const speakers = devices.filter(device => 
                  device.kind === 'audiooutput' && 
                  (device.label.toLowerCase().includes('speaker') || 
                   device.label.toLowerCase().includes('loud'))
                )
                
                if (speakers.length > 0) {
                  // Use the first available speaker device
                  activeAudioOutputDeviceRef.current = speakers[0].deviceId
                  ;(audio as any).setSinkId(speakers[0].deviceId).catch((err: any) => {
                    console.log('[Speaker] Device not available, using volume control:', err.message)
                  })
                } else {
                  // No specific speaker found, rely on volume control
                  console.log('[Speaker] No speaker device found, using volume control')
                }
              })
              .catch(err => {
                console.log('[Speaker] Device enumeration failed, using volume control:', err.message)
              })
          }
        } else {
          // EARPIECE/BLUETOOTH MODE (Return to active device)
          audio.volume = 0.85 // Moderate volume for earpiece/Bluetooth
          
          // CRITICAL FIX: Re-apply the detected audio output device (Bluetooth or default)
          setAudioOutputDevice(audio).catch(err => 
            console.warn('[Earpiece] Failed to restore audio device:', err)
          )
        }
      })
      
      return newSpeakerState
    })
  }, [setAudioOutputDevice])

  // Expose methods via ref
  useImperativeHandle(ref, () => ({
    startCall,
    joinCall,
  }), [startCall, joinCall])

  // Socket event handlers
  useEffect(() => {
    if (!socket) return

    // Call started by someone
    socket.on('call:started', ({ initiatorId, initiatorName, initiatorSocketId }) => {
      if (initiatorId !== userId) {
        setParticipants(prev => {
          const updated = new Map(prev)
          updated.set(initiatorId, { name: initiatorName, socketId: initiatorSocketId })
          return updated
        })
      }
    })

    // Someone joined the call
    socket.on('call:user-joined', async ({ userId: joinedUserId, userName: joinedUserName, socketId: joinedSocketId }) => {
      if (joinedUserId === userId) return

      setParticipants(prev => {
        const updated = new Map(prev)
        updated.set(joinedUserId, { name: joinedUserName, socketId: joinedSocketId })
        return updated
      })

      // If we're already in the call, create offer for the new user
      if (isCallActive && localStreamRef.current) {
        const pc = createPeerConnection(joinedSocketId, joinedUserName)
        try {
          const offer = await pc.createOffer()
          await pc.setLocalDescription(offer)
          socket.emit('call:offer', {
            roomId,
            to: joinedSocketId,
            offer,
          })
        } catch (error) {
          console.error('Error creating offer:', error)
        }
      }
    })

    // Received an offer
    socket.on('call:offer', async ({ from, fromName, offer }) => {
      if (!isCallActive || !localStreamRef.current) return

      const pc = createPeerConnection(from, fromName)
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer))
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        socket.emit('call:answer', {
          roomId,
          to: from,
          answer,
        })
      } catch (error) {
        console.error('Error handling offer:', error)
      }
    })

    // Received an answer
    socket.on('call:answer', async ({ from, answer }) => {
      const peerConnection = peerConnectionsRef.current.get(from)
      if (peerConnection) {
        try {
          await peerConnection.connection.setRemoteDescription(new RTCSessionDescription(answer))
        } catch (error) {
          console.error('Error setting remote description:', error)
        }
      }
    })

    // Received an ICE candidate
    socket.on('call:ice-candidate', async ({ from, candidate }) => {
      const peerConnection = peerConnectionsRef.current.get(from)
      if (peerConnection) {
        try {
          await peerConnection.connection.addIceCandidate(new RTCIceCandidate(candidate))
        } catch (error) {
          console.error('Error adding ICE candidate:', error)
        }
      }
    })

    // Someone left the call
    socket.on('call:user-left', ({ userId: leftUserId, socketId: leftSocketId }) => {
      const peerConnection = peerConnectionsRef.current.get(leftSocketId)
      if (peerConnection) {
        peerConnection.connection.close()
        peerConnectionsRef.current.delete(leftSocketId)
      }

      const audio = audioElementsRef.current.get(leftSocketId)
      if (audio) {
        audio.pause()
        audio.srcObject = null
        audio.remove()
        audioElementsRef.current.delete(leftSocketId)
      }

      setParticipants(prev => {
        const updated = new Map(prev)
        updated.delete(leftUserId)
        return updated
      })
    })

    // Call ended by initiator
    socket.on('call:ended', () => {
      cleanup()
    })

    return () => {
      socket.off('call:started')
      socket.off('call:user-joined')
      socket.off('call:offer')
      socket.off('call:answer')
      socket.off('call:ice-candidate')
      socket.off('call:user-left')
      socket.off('call:ended')
    }
  }, [socket, userId, isCallActive, createPeerConnection, roomId, cleanup])

  // Restore active call state from localStorage on mount (page refresh recovery)
  useEffect(() => {
    if (!socket || hasRestoredRef.current) return
    hasRestoredRef.current = true

    try {
      const stored = localStorage.getItem(`active-call-${roomId}`)
      if (!stored) return

      const callState = JSON.parse(stored)
      // Only restore if the call was active within the last 30 minutes (prevent stale state)
      const isRecent = Date.now() - callState.timestamp < 30 * 60 * 1000
      
      if (callState.isActive && isRecent && callState.userId === userId) {
        console.log('Restoring active call state from localStorage')
        // Automatically rejoin the call
        setTimeout(() => {
          if (callState.isInitiator) {
            startCall()
          } else {
            joinCall()
          }
        }, 500) // Small delay to ensure socket is fully connected
      } else if (!isRecent) {
        // Clean up stale call state
        localStorage.removeItem(`active-call-${roomId}`)
      }
    } catch (err) {
      console.warn('Failed to restore call state from localStorage:', err)
    }
  }, [socket, roomId, userId, startCall, joinCall])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup()
    }
  }, [cleanup])

  if (!isCallActive && participants.size === 0) {
    if (hideStartButton) return null
    return (
      <button
        onClick={startCall}
        className="rounded-2xl flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors bg-black border border-[#50C878] text-white"
        title="Start group call"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="currentColor" viewBox="0 0 16 16">
          <path fillRule="evenodd" d="M1.885.511a1.745 1.745 0 0 1 2.61.163L6.29 2.98c.329.423.445.974.315 1.494l-.547 2.19a.678.678 0 0 0 .178.643l2.457 2.457a.678.678 0 0 0 .644.178l2.189-.547a1.745 1.745 0 0 1 1.494.315l2.306 1.794c.829.645.905 1.87.163 2.611l-1.034 1.034c-.74.74-1.846 1.065-2.877.702a18.634 18.634 0 0 1-7.01-4.42 18.634 18.634 0 0 1-4.42-7.009c-.362-1.03-.037-2.137.703-2.877L1.885.511z"/>
        </svg>
        Tap In
      </button>
    )
  }

  if (!isCallActive && participants.size > 0) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-2xl text-xs bg-blue-500/10 text-blue-400 border border-blue-500/30">
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="currentColor" viewBox="0 0 16 16" className="animate-pulse">
            <path fillRule="evenodd" d="M1.885.511a1.745 1.745 0 0 1 2.61.163L6.29 2.98c.329.423.445.974.315 1.494l-.547 2.19a.678.678 0 0 0 .178.643l2.457 2.457a.678.678 0 0 0 .644.178l2.189-.547a1.745 1.745 0 0 1 1.494.315l2.306 1.794c.829.645.905 1.87.163 2.611l-1.034 1.034c-.74.74-1.846 1.065-2.877.702a18.634 18.634 0 0 1-7.01-4.42 18.634 18.634 0 0 1-4.42-7.009c-.362-1.03-.037-2.137.703-2.877L1.885.511z"/>
          </svg>
          <span>On Air • {participants.size}</span>
        </div>
        <button
          onClick={joinCall}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-2xl text-xs font-medium transition-all bg-black border border-[#50C878] text-white animate-pulse hover:scale-105 active:scale-95"
          title="Join call"
        >
          Engage
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-2xl text-xs bg-green-600/10 text-green-400 border border-green-500/30">
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="currentColor" viewBox="0 0 16 16" className="animate-pulse">
          <path fillRule="evenodd" d="M1.885.511a1.745 1.745 0 0 1 2.61.163L6.29 2.98c.329.423.445.974.315 1.494l-.547 2.19a.678.678 0 0 0 .178.643l2.457 2.457a.678.678 0 0 0 .644.178l2.189-.547a1.745 1.745 0 0 1 1.494.315l2.306 1.794c.829.645.905 1.87.163 2.611l-1.034 1.034c-.74.74-1.846 1.065-2.877.702a18.634 18.634 0 0 1-7.01-4.42 18.634 18.634 0 0 1-4.42-7.009c-.362-1.03-.037-2.137.703-2.877L1.885.511z"/>
        </svg>
        <span>{participants.size === 0 ? 'On Air ' : `Together • ${participants.size + 1}`}</span>
      </div>
      <button
        onClick={toggleMute}
        className={`p-1.5 rounded-2xl text-xs transition-colors ${
          isMuted
            ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
            : 'bg-gray-700/50 text-gray-300 hover:bg-gray-700'
        }`}
        title={isMuted ? 'Unmute' : 'Mute'}
      >
        {isMuted ? (
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="currentColor" viewBox="0 0 16 16">
            <path d="M13 8c0 .564-.094 1.107-.266 1.613l-.814-.814A4.02 4.02 0 0 0 12 8V7a.5.5 0 0 1 1 0zm-5 4c.818 0 1.578-.245 2.212-.667l.718.719a4.973 4.973 0 0 1-2.43.923V15h3a.5.5 0 0 1 0 1h-7a.5.5 0 0 1 0-1h3v-2.025A5 5 0 0 1 3 8V7a.5.5 0 0 1 1 0v1a4 4 0 0 0 4 4m3-9v4.879l-1-1V3a2 2 0 0 0-3.997-.118l-.845-.845A3.001 3.001 0 0 1 11 3"/>
            <path d="m9.486 10.607-.748-.748A2 2 0 0 1 6 8v-.878l-1-1V8a3 3 0 0 0 4.486 2.607m-7.84-9.253 12 12 .708-.708-12-12z"/>
          </svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="currentColor" viewBox="0 0 16 16">
            <path d="M5 3a3 3 0 0 1 6 0v5a3 3 0 0 1-6 0z"/>
            <path d="M3.5 6.5A.5.5 0 0 1 4 7v1a4 4 0 0 0 8 0V7a.5.5 0 0 1 1 0v1a5 5 0 0 1-4.5 4.975V15h3a.5.5 0 0 1 0 1h-7a.5.5 0 0 1 0-1h3v-2.025A5 5 0 0 1 3 8V7a.5.5 0 0 1 .5-.5"/>
          </svg>
        )}
      </button>
      <button
        onClick={toggleSpeaker}
        className={`p-1.5 rounded-2xl text-xs transition-all ${
          isSpeakerOn
            ? 'bg-blue-500/30 text-blue-400 hover:bg-blue-500/40 shadow-lg shadow-blue-500/20'
            : 'bg-gray-700/50 text-gray-300 hover:bg-gray-700'
        }`}
        title={isSpeakerOn ? 'Use Earpiece' : 'Use Speaker'}
      >
        {isSpeakerOn ? (
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="currentColor" viewBox="0 0 16 16" className="animate-pulse">
            <path d="M11.536 14.01A8.473 8.473 0 0 0 14.026 8a8.473 8.473 0 0 0-2.49-6.01l-.708.707A7.476 7.476 0 0 1 13.025 8c0 2.071-.84 3.946-2.197 5.303z"/>
            <path d="M10.121 12.596A6.48 6.48 0 0 0 12.025 8a6.48 6.48 0 0 0-1.904-4.596l-.707.707A5.483 5.483 0 0 1 11.025 8a5.483 5.483 0 0 1-1.61 3.89z"/>
            <path d="M8.707 11.182A4.486 4.486 0 0 0 10.025 8a4.486 4.486 0 0 0-1.318-3.182L8 5.525A3.489 3.489 0 0 1 9.025 8 3.49 3.49 0 0 1 8 10.475zM6.717 3.55A.5.5 0 0 1 7 4v8a.5.5 0 0 1-.812.39L3.825 10.5H1.5A.5.5 0 0 1 1 10V6a.5.5 0 0 1 .5-.5h2.325l2.363-1.89a.5.5 0 0 1 .529-.06"/>
          </svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="currentColor" viewBox="0 0 16 16">
            <path d="M6.717 3.55A.5.5 0 0 1 7 4v8a.5.5 0 0 1-.812.39L3.825 10.5H1.5A.5.5 0 0 1 1 10V6a.5.5 0 0 1 .5-.5h2.325l2.363-1.89a.5.5 0 0 1 .529-.06m7.137 2.096a.5.5 0 0 1 0 .708L12.207 8l1.647 1.646a.5.5 0 0 1-.708.708L11.5 8.707l-1.646 1.647a.5.5 0 0 1-.708-.708L10.793 8 9.146 6.354a.5.5 0 1 1 .708-.708L11.5 7.293l1.646-1.647a.5.5 0 0 1 .708 0"/>
          </svg>
        )}
      </button>
      <div className="flex-1" />
      <button
        onClick={endCall}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-2xl text-xs font-medium transition-colors border border-[#7e0000] text-white"
        title={isInitiator ? 'End call for everyone' : 'Leave call'}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="currentColor" viewBox="0 0 16 16">
          <path fillRule="evenodd" d="M1.885.511a1.745 1.745 0 0 1 2.61.163L6.29 2.98c.329.423.445.974.315 1.494l-.547 2.19a.678.678 0 0 0 .178.643l2.457 2.457a.678.678 0 0 0 .644.178l2.189-.547a1.745 1.745 0 0 1 1.494.315l2.306 1.794c.829.645.905 1.87.163 2.611l-1.034 1.034c-.74.74-1.846 1.065-2.877.702a18.634 18.634 0 0 1-7.01-4.42 18.634 18.634 0 0 1-4.42-7.009c-.362-1.03-.037-2.137.703-2.877L1.885.511z"/>
        </svg>
        {isInitiator ? 'Dip Out' : 'Bounce'}
      </button>
    </div>
  )
})

GroupCall.displayName = 'GroupCall'

export default GroupCall
