import { TaskList } from '../components/TaskList'
import { VideoForm } from '../components/VideoForm'

/** 手动生成入口：不经过账号类型、模板和审核流程，直接用提示词生成，用于调试工作流。 */
export function EnginePage() {
  return (
    <div className="grid-2">
      <VideoForm />
      <TaskList />
    </div>
  )
}
