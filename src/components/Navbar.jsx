import { Button } from './ui/button'
import { LogOut, Plus, User } from 'lucide-react'
import { useAuth } from './AuthContext'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
// Import the logo image
import logo from './logo.png' 

export default function Navbar({ onCreateProject }) {
  const { user, logout } = useAuth()

  const handleLogout = async () => {
    await logout()
    // The logout will clear the user state, which will trigger the App component
    // to show the AuthModal automatically since user will be null
  }

  return (
    <nav className="bg-white border-b border-gray-200 px-6 py-4">
      <div className="flex items-center justify-between">
        {/* Logo */}
        <div className="flex items-center space-x-2">
          {/* Replace the icon and text with the logo image */}
          <img src={logo} alt="Nexus Logo" className="h-8 w-auto flex-shrink-0" />
        </div>

        {/* Right side buttons */}
        <div className="flex items-center space-x-4">
          <Button 
            onClick={onCreateProject}
            className="bg-orange-600 hover:bg-blue-700 text-white"
          >
            <Plus className="h-4 w-4 mr-2" />
            Project Board
          </Button>
          
          <Button 
            variant="outline" 
            onClick={handleLogout}
            className="text-gray-700 border-gray-300 hover:bg-gray-50"
          >
            <LogOut className="h-4 w-4 mr-2" />
            Logout
          </Button>
        </div>
      </div>
    </nav>
  )
}