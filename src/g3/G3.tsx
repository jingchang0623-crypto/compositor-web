// The G3 user-test pages: ?g3=task (default), survey, observe, results. See docs/g3/README.md.

import { Observe, Results } from './Moderator'
import { Survey, TaskCard } from './Participant'
import './g3.css'

export function G3({ page }: { page: string }) {
  if (page === 'survey') return <Survey />
  if (page === 'observe') return <Observe />
  if (page === 'results') return <Results />
  return <TaskCard />
}
