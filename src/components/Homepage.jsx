import ProjectFeed from './ProjectFeed'

export default function Homepage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1">
          {/* Center - Project Feed */}
          <div className="lg:col-span-4">
            <ProjectFeed />
          </div>
        </div>
      </div>
    </div>
  )
}
