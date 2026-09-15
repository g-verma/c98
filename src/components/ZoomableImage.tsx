'use client'

import { useState, useRef, useEffect } from 'react'

interface ZoomableImageProps {
  src: string
  alt: string
  onClose?: () => void
  className?: string
}

export default function ZoomableImage({ src, alt, onClose, className = '' }: ZoomableImageProps) {
  const [scale, setScale] = useState(1)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const imageRef = useRef<HTMLDivElement>(null)
  const startPosRef = useRef({ x: 0, y: 0 })
  const lastDistanceRef = useRef(0)
  const lastTapRef = useRef(0)

  // Reset zoom when image changes
  useEffect(() => {
    setScale(1)
    setPosition({ x: 0, y: 0 })
  }, [src])

  // Handle double tap to zoom
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      const now = Date.now()
      const timeSinceLastTap = now - lastTapRef.current
      
      if (timeSinceLastTap < 300 && timeSinceLastTap > 0) {
        // Double tap detected
        e.preventDefault()
        if (scale > 1) {
          // Zoom out
          setScale(1)
          setPosition({ x: 0, y: 0 })
        } else {
          // Zoom in to 2x at tap location
          const rect = imageRef.current?.getBoundingClientRect()
          if (rect) {
            const touch = e.touches[0]
            const x = touch.clientX - rect.left - rect.width / 2
            const y = touch.clientY - rect.top - rect.height / 2
            setScale(2)
            setPosition({ x: -x, y: -y })
          }
        }
        lastTapRef.current = 0
      } else {
        lastTapRef.current = now
        // Single touch - prepare for drag
        if (scale > 1) {
          startPosRef.current = {
            x: e.touches[0].clientX - position.x,
            y: e.touches[0].clientY - position.y,
          }
          setIsDragging(true)
        }
      }
    } else if (e.touches.length === 2) {
      // Pinch zoom
      e.preventDefault()
      const touch1 = e.touches[0]
      const touch2 = e.touches[1]
      const distance = Math.hypot(
        touch2.clientX - touch1.clientX,
        touch2.clientY - touch1.clientY
      )
      lastDistanceRef.current = distance
    }
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 1 && isDragging && scale > 1) {
      // Drag to pan
      e.preventDefault()
      const newX = e.touches[0].clientX - startPosRef.current.x
      const newY = e.touches[0].clientY - startPosRef.current.y
      setPosition({ x: newX, y: newY })
    } else if (e.touches.length === 2) {
      // Pinch zoom
      e.preventDefault()
      const touch1 = e.touches[0]
      const touch2 = e.touches[1]
      const distance = Math.hypot(
        touch2.clientX - touch1.clientX,
        touch2.clientY - touch1.clientY
      )
      
      if (lastDistanceRef.current > 0) {
        const delta = distance / lastDistanceRef.current
        const newScale = Math.max(1, Math.min(4, scale * delta))
        setScale(newScale)
        
        // Reset position when zooming out to 1x
        if (newScale === 1) {
          setPosition({ x: 0, y: 0 })
        }
      }
      
      lastDistanceRef.current = distance
    }
  }

  const handleTouchEnd = () => {
    setIsDragging(false)
    lastDistanceRef.current = 0
  }

  // Mouse wheel zoom for desktop
  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      const delta = e.deltaY > 0 ? 0.9 : 1.1
      const newScale = Math.max(1, Math.min(4, scale * delta))
      setScale(newScale)
      
      if (newScale === 1) {
        setPosition({ x: 0, y: 0 })
      }
    }
  }

  return (
    <div
      ref={imageRef}
      className={`relative w-full h-full flex items-center justify-center overflow-hidden ${className}`}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onWheel={handleWheel}
      style={{ touchAction: scale > 1 ? 'none' : 'auto' }}
    >
      <img
        src={src}
        alt={alt}
        draggable={false}
        className="block rounded-xl shadow-2xl select-none"
        style={{
          maxWidth: scale === 1 ? '100%' : 'none',
          maxHeight: scale === 1 ? '90dvh' : 'none',
          objectFit: 'contain',
          transform: `scale(${scale}) translate(${position.x / scale}px, ${position.y / scale}px)`,
          transition: isDragging ? 'none' : 'transform 0.2s ease-out',
          cursor: scale > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default',
        }}
      />
      {scale > 1 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/60 text-white/90 px-3 py-1.5 rounded-full text-xs font-medium">
          {Math.round(scale * 100)}%
        </div>
      )}
    </div>
  )
}
