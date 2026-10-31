import { useState } from 'react'
import { CatalogScreen } from './screens/CatalogScreen'
import { GuestRoomScreen } from './screens/GuestRoomScreen'
import { HostRoomScreen } from './screens/HostRoomScreen'
import { JoinScreen } from './screens/JoinScreen'
import { ProfileScreen } from './screens/ProfileScreen'
import { clearProfile, loadProfile, saveProfile } from './profile'
import type { Profile } from './types'

type Screen =
  | { name: 'catalog' }
  | { name: 'profile' }
  | { name: 'join' }
  | { name: 'host'; gameId: string }
  | { name: 'guest'; code: string }

export default function App() {
  const [profile, setProfile] = useState<Profile | null>(loadProfile)
  const [screen, setScreen] = useState<Screen>({ name: 'catalog' })

  function handleSave(next: Profile) {
    saveProfile(next)
    setProfile(next)
    setScreen({ name: 'catalog' })
  }

  function handleDelete() {
    clearProfile()
    setProfile(null)
    setScreen({ name: 'catalog' })
  }

  const goCatalog = () => setScreen({ name: 'catalog' })

  if (!profile) {
    return <ProfileScreen initial={null} onSave={handleSave} />
  }

  if (screen.name === 'profile') {
    return (
      <ProfileScreen
        initial={profile}
        onSave={handleSave}
        onDelete={handleDelete}
        onCancel={goCatalog}
      />
    )
  }

  if (screen.name === 'join') {
    return (
      <JoinScreen
        onBack={goCatalog}
        onJoin={(code) => setScreen({ name: 'guest', code })}
      />
    )
  }

  if (screen.name === 'host') {
    return <HostRoomScreen gameId={screen.gameId} me={profile} onLeave={goCatalog} />
  }

  if (screen.name === 'guest') {
    return <GuestRoomScreen code={screen.code} me={profile} onLeave={goCatalog} />
  }

  return (
    <CatalogScreen
      profile={profile}
      onHost={(gameId) => setScreen({ name: 'host', gameId })}
      onJoin={() => setScreen({ name: 'join' })}
      onEditProfile={() => setScreen({ name: 'profile' })}
    />
  )
}
