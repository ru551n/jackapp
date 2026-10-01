import { useState } from 'react'
import { useNavigate } from 'react-router'
import { RunHistory as Runs } from '../runs'
import { StudySetList, StudySetView as SetView, StudyUpload as Upload, TestConfigurator } from '../study'

// Adult-area adapters around the shared study and runs components (src/features/study, src/features/runs).

/** Upload new material and list existing study sets. */
export function StudyUpload({ learnerId }: { learnerId: string }) {
  const navigate = useNavigate()
  const [refresh, setRefresh] = useState(0)
  return (
    <>
      <Upload learnerId={learnerId} variant="adult" onUploaded={() => setRefresh((n) => n + 1)} />
      <StudySetList learnerId={learnerId} variant="adult" refreshKey={refresh} onOpen={(id) => navigate(id)} />
    </>
  )
}

/** One study set; "Skapa prov" opens the test configurator, then the new material. */
export function StudySetView({ learnerId, setId }: { learnerId: string; setId: string }) {
  const navigate = useNavigate()
  const [configuring, setConfiguring] = useState(false)
  if (configuring)
    return (
      <TestConfigurator
        learnerId={learnerId}
        variant="adult"
        studySetId={setId}
        onCreated={(artifactId) => navigate(`/vuxen/elev/${learnerId}/material/${artifactId}`)}
        onCancel={() => setConfiguring(false)}
      />
    )
  return <SetView learnerId={learnerId} variant="adult" setId={setId} onConfigure={() => setConfiguring(true)} />
}

export function RunHistory({ learnerId }: { learnerId: string }) {
  return <Runs learnerId={learnerId} variant="adult" />
}
