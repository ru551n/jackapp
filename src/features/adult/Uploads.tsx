import { Route, Routes, useParams } from 'react-router'
import { useLearner } from './context'
import { StudySetView, StudyUpload } from './slots'

function SetView() {
  const { learner } = useLearner()
  const { setId = '' } = useParams()
  return <StudySetView learnerId={learner.id} setId={setId} />
}

/** `/vuxen/elev/:id/studiematerial[/:setId]`: mounts the study area's upload and set views. */
export function Uploads() {
  const { learner } = useLearner()
  return (
    <Routes>
      <Route index element={<StudyUpload learnerId={learner.id} />} />
      <Route path=":setId" element={<SetView />} />
    </Routes>
  )
}
