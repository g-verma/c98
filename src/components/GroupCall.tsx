'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import type { Socket } from 'socket.io-client'

interface GroupCallProps {
  socket: Socket | null
  roomId: string
  userName: string
  userId: string
}

interface PeerConnection {
  connection: RTCPeerConnection
  stream?: MediaStream
}

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
}

export default function GroupCall({ socket, roomId, userName, userId }: GroupCallProps) {
  const [isCallActive, setIsCallActive] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [participants, setParticipants] = useState<Map<string, { name: string; stream?: MediaStream }>>(new Map())
  const [isInitiator, setIsInitiator] = useState(false)
  
  const localStreamRef = useRef<MediaStream | null>(null)
  const peerConnectionsRef = useRef<Map<string, PeerConnection>>(new Map())
  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map())

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
    })
    audioElementsRef.current.clear()

    setParticipants(new Map())
    setIsCallActive(false)
    setIsInitiator(false)
  }, [])

  // Create peer connection for a specific user
  const createPeerConnection = useCallback((peerId: string, peerName: string): RTCPeerConnection => {
    const pc = new RTCPeerConnection(ICE_SERVERS)

    // Add local stream tracks to the connection
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current!)
      })
    }

    // Handle incoming remote stream
    pc.ontrack = (event) => {
      const [remoteStream] = event.streams
      if (remoteStream) {
        // Update participant with stream
        setParticipants(prev => {
          const updated = new Map(prev)
          updated.set(peerId, { name: peerName, stream: remoteStream })
          return updated
        })

        // Create or update audio element
        let audio = audioElementsRef.current.get(peerId)
        if (!audio) {
          audio = new Audio()
          audio.autoplay = true
          audioElementsRef.current.set(peerId, audio)
        }
        audio.srcObject = remoteStream
        audio.play().catch(err => console.error('Audio autoplay error:', err))
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

    // Handle connection state changes
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        console.log(`Peer ${peerId} disconnected`)
        peerConnectionsRef.current.delete(peerId)
        audioElementsRef.current.get(peerId)?.pause()
        audioElementsRef.current.delete(peerId)
        setParticipants(prev => {
          const updated = new Map(prev)
          updated.delete(peerId)
          return updated
        })
      }
    }

    peerConnectionsRef.current.set(peerId, { connection: pc })
    return pc
  }, [socket, roomId])

  // Start the call
  const startCall = useCallback(async () => {
    if (!socket) return

    try {
      // Get user audio with echo cancellation and noise suppression
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      })

      localStreamRef.current = stream
      setIsCallActive(true)
      setIsInitiator(true)

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
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      })

      localStreamRef.current = stream
      setIsCallActive(true)

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
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0]
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled
        setIsMuted(!audioTrack.enabled)
      }
    }
  }, [])

  // Socket event handlers
  useEffect(() => {
    if (!socket) return

    // Call started by someone
    socket.on('call:started', ({ initiatorId, initiatorName }) => {
      if (initiatorId !== userId) {
        setParticipants(prev => {
          const updated = new Map(prev)
          updated.set(initiatorId, { name: initiatorName })
          return updated
        })
      }
    })

    // Someone joined the call
    socket.on('call:user-joined', async ({ userId: joinedUserId, userName: joinedUserName }) => {
      if (joinedUserId === userId) return

      setParticipants(prev => {
        const updated = new Map(prev)
        updated.set(joinedUserId, { name: joinedUserName })
        return updated
      })

      // If we're already in the call, create offer for the new user
      if (isCallActive && localStreamRef.current) {
        const pc = createPeerConnection(joinedUserId, joinedUserName)
        try {
          const offer = await pc.createOffer()
          await pc.setLocalDescription(offer)
          socket.emit('call:offer', {
            roomId,
            to: joinedUserId,
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
    socket.on('call:user-left', ({ userId: leftUserId }) => {
      const peerConnection = peerConnectionsRef.current.get(leftUserId)
      if (peerConnection) {
        peerConnection.connection.close()
        peerConnectionsRef.current.delete(leftUserId)
      }

      const audio = audioElementsRef.current.get(leftUserId)
      if (audio) {
        audio.pause()
        audio.srcObject = null
        audioElementsRef.current.delete(leftUserId)
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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup()
    }
  }, [cleanup])

  if (!isCallActive && participants.size === 0) {
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
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-2xl text-xs font-medium transition-colors bg-black border border-[#50C878] text-white"
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
        <span>Together • {participants.size + 1}</span>
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
}
