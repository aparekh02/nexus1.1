import { useState, useEffect } from 'react'
import AuthModal from './components/AuthModal'
import Homepage from './components/Homepage'
import { Button } from './components/ui/button'
import Navbar from './components/Navbar'
import CreateProject from './components/CreateProject'
import { BookOpen } from 'lucide-react'
import './App.css'
import logo from './logo.png' 

// Assuming AuthProvider and useAuth are still relevant for other parts of the app
// If not, these can be removed along with their usage
import { AuthProvider, useAuth } from './components/AuthContext'

function AppContent() {
  const { user, loading, login, logout } = useAuth() // Assuming useAuth provides login/logout
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false)
  const [currentPage, setCurrentPage] = useState('home')

  // Handle successful authentication from AuthModal
  const handleAuthSuccess = (userData) => {
    // Assuming useAuth has a way to update the user state internally
    // If not, you might need to call a login function from AuthContext here
    // For now, we'll rely on the AuthContext to update its state based on localStorage
    setIsAuthModalOpen(false)
    // The user state in AuthContext should update automatically if it reads from localStorage
    // If not, you might need to trigger a re-fetch or update the context directly
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center">
            <div className="mb-8">
              <div className="flex items-center justify-center space-x-2 mb-4">
                <img src={logo} alt="Nexus Logo" className="h-32 w-auto flex-shrink-0" />
              </div>
              <p className="text-xl text-gray-600 mb-8">
                A Community for Studying & Connectiung with Students
              </p>
            </div>
            
            <Button 
              onClick={() => setIsAuthModalOpen(true)}
              className="bg-orange-600 hover:bg-blue-700 text-white px-8 py-3 text-lg"
            >
              Get Started
            </Button>
          </div>
        </div>
        
        <AuthModal 
          isOpen={isAuthModalOpen} 
          onClose={() => setIsAuthModalOpen(false)} 
          onAuthSuccess={handleAuthSuccess} // Pass the new handler
        />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar onCreateProject={() => setCurrentPage('create-project')} onLogout={logout} />
      
      {currentPage === 'home' && <Homepage />}
      {currentPage === 'create-project' && (
        <CreateProject onBack={() => setCurrentPage('home')} />
      )}
    </div>
  )
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  )
}

export default App


