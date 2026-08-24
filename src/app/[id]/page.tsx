'use client'

import { useParams } from 'next/navigation'
import RoomClient from '@/components/RoomClient'

export default function RoomPage() {
  const params = useParams()
  const id = (params?.id as string) ?? ''
  return <RoomClient roomId={id} />
}
