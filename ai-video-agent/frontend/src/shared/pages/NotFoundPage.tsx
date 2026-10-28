import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <div className="state-box">
      <h2>页面不存在</h2>
      <Link to="/" className="btn-link">回到首页</Link>
    </div>
  )
}
