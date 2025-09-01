import { useState, useCallback, useMemo } from 'react'
import axios from 'axios'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'
import { X } from 'lucide-react'

// Set the base URL for your Flask backend (deployed, not localhost)
const API_BASE_URL = 'https://nexus-backend-f2td.onrender.com'
axios.defaults.baseURL = API_BASE_URL

// Configure axios to use JWT tokens instead of cookies
axios.defaults.withCredentials = false

// Predefined class options (matching the Flask backend)
const CLASSES = ["Math", "Science", "History", "Art", "Computer Science", "English"]

// Validation utilities
const validateEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}

const validatePassword = (password) => {
  return password.length >= 6
}

const validateName = (name) => {
  return name.trim().length >= 2
}

export default function AuthModal({ isOpen, onClose, onAuthSuccess }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [validationErrors, setValidationErrors] = useState({})

  const [loginData, setLoginData] = useState({
    email: '',
    password: ''
  })

  const [signupData, setSignupData] = useState({
    name: '',
    email: '',
    password: '',
    school: '',
    classes: [],
    confirmPassword: ''
  })

  // Real-time validation for signup form
  const signupValidation = useMemo(() => {
    const errors = {}
    
    if (signupData.name && !validateName(signupData.name)) {
      errors.name = 'Name must be at least 2 characters'
    }
    
    if (signupData.email && !validateEmail(signupData.email)) {
      errors.email = 'Please enter a valid email address'
    }
    
    if (signupData.password && !validatePassword(signupData.password)) {
      errors.password = 'Password must be at least 6 characters'
    }
    
    if (signupData.confirmPassword && signupData.password !== signupData.confirmPassword) {
      errors.confirmPassword = 'Passwords do not match'
    }
    
    if (signupData.school && signupData.school.trim().length < 2) {
      errors.school = 'School name must be at least 2 characters'
    }
    
    return errors
  }, [signupData])

  // Check if signup form is valid
  const isSignupFormValid = useMemo(() => {
    return (
      validateName(signupData.name) &&
      validateEmail(signupData.email) &&
      validatePassword(signupData.password) &&
      signupData.password === signupData.confirmPassword &&
      signupData.school.trim().length >= 2 &&
      signupData.classes.length > 0 &&
      Object.keys(signupValidation).length === 0
    )
  }, [signupData, signupValidation])

  // Helper function to handle successful authentication
  const handleAuthSuccess = (userData, message) => {
    // Store user data in localStorage
    if (userData) {
      // Store the JWT token separately for easy access
      if (userData.token) {
        localStorage.setItem('jwt_token', userData.token);
        // Set authorization header for future requests
        axios.defaults.headers.common['Authorization'] = `Bearer ${userData.token}`;
      }
      
      // Store user data without the token
      const userDataWithoutToken = { ...userData };
      delete userDataWithoutToken.token;
      localStorage.setItem('user', JSON.stringify(userDataWithoutToken));
    }
    
    // Show success message
    console.log('Authentication successful:', message);
    
    // Close the modal
    onClose();
    
    // Call the parent component's auth success handler if provided
    if (onAuthSuccess && typeof onAuthSuccess === 'function') {
      onAuthSuccess(userData);
    }
    
    // Always refresh the page after successful authentication
    setTimeout(() => {
      window.location.reload();
    }, 100);
  }

  // Optimized input handlers
  const updateLoginData = useCallback((field, value) => {
    setLoginData(prev => ({ ...prev, [field]: value }))
    if (error) setError('')
  }, [error])

  const updateSignupData = useCallback((field, value) => {
    setSignupData(prev => ({ ...prev, [field]: value }))
    if (error) setError('')
    
    // Clear specific validation error when user starts typing
    if (validationErrors[field]) {
      setValidationErrors(prev => {
        const newErrors = { ...prev }
        delete newErrors[field]
        return newErrors
      })
    }
  }, [error, validationErrors])

  const handleLogin = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      // Use full URL for backend endpoint
      const response = await axios.post(`${API_BASE_URL}/api/login`, {
        email: loginData.email,
        password: loginData.password
      }, {
        headers: {
          'Content-Type': 'application/json',
        }
      });
      
      // Handle JSON response from Flask backend
      if (response.data.success) {
        handleAuthSuccess(response.data.user, response.data.message || 'Login successful');
        // Reset form on successful login
        setLoginData({ email: '', password: '' })
      } else {
        setError(response.data.message || 'Login failed');
      }
    } catch (err) {
      console.error('Login error:', err);
      setError(err.response?.data?.error || err.response?.data?.message || 'Login failed');
    }
    setLoading(false)
  }

  const handleSignup = async (e) => {
    e.preventDefault()
    
    // Final validation check
    if (!isSignupFormValid) {
      setValidationErrors(signupValidation)
      if (signupData.classes.length === 0) {
        setError('Please select at least one class')
      }
      return
    }

    setLoading(true)
    setError('')
    setValidationErrors({})

    try {
      // Use full URL for backend endpoint
      const response = await axios.post(`${API_BASE_URL}/api/signup`, {
        name: signupData.name.trim(),
        email: signupData.email,
        password: signupData.password,
        school: signupData.school.trim(),
        classes: signupData.classes
      }, {
        headers: {
          'Content-Type': 'application/json',
        }
      });

      // Handle JSON response from Flask backend
      if (response.data.success) {
        // Show success message for signup
        alert(response.data.message || 'Account created successfully!');
        handleAuthSuccess(response.data.user, response.data.message || 'Account created successfully');
        // Reset form on successful signup
        setSignupData({
          name: '',
          email: '',
          password: '',
          school: '',
          classes: [],
          confirmPassword: ''
        })
      } else {
        setError(response.data.message || 'Signup failed');
      }
    } catch (err) {
      console.error('Signup error:', err);
      setError(err.response?.data?.error || err.response?.data?.message || 'Failed to create account. Please try again.');
    }
    setLoading(false)
  }

  const handleClassToggle = useCallback((className) => {
    setSignupData(prev => ({
      ...prev,
      classes: prev.classes.includes(className)
        ? prev.classes.filter(c => c !== className)
        : [...prev.classes, className]
    }))
    if (error) setError('')
  }, [error])

  // Quick class selection helpers
  const selectAllClasses = useCallback(() => {
    setSignupData(prev => ({ ...prev, classes: [...CLASSES] }))
    if (error) setError('')
  }, [])

  const clearAllClasses = useCallback(() => {
    setSignupData(prev => ({ ...prev, classes: [] }))
  }, [])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md mx-4 relative max-h-[90vh] overflow-y-auto">
        <Button
          variant="ghost"
          size="sm"
          className="absolute top-2 right-2"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>

        <Tabs defaultValue="login" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="login">Login</TabsTrigger>
            <TabsTrigger value="signup">Sign Up</TabsTrigger>
          </TabsList>

          <TabsContent value="login">
            <Card>
              <CardHeader>
                <CardTitle>Login</CardTitle>
                <CardDescription>
                  Enter your credentials to access your account
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleLogin} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="login-email">Email</Label>
                    <Input
                      id="login-email"
                      type="email"
                      value={loginData.email}
                      onChange={(e) => updateLoginData('email', e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="login-password">Password</Label>
                    <Input
                      id="login-password"
                      type="password"
                      value={loginData.password}
                      onChange={(e) => updateLoginData('password', e.target.value)}
                      required
                    />
                  </div>
                  {error && <p className="text-red-500 text-sm">{error}</p>}
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? 'Logging in...' : 'Login'}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="signup">
            <Card>
              <CardHeader>
                <CardTitle>Create Account</CardTitle>
                <CardDescription>
                  Fill in your information to create a new account
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSignup} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="signup-name">Full Name</Label>
                    <Input
                      id="signup-name"
                      value={signupData.name}
                      onChange={(e) => updateSignupData('name', e.target.value)}
                      required
                      className={validationErrors.name ? 'border-red-500' : ''}
                    />
                    {validationErrors.name && (
                      <p className="text-red-500 text-xs">{validationErrors.name}</p>
                    )}
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="signup-email">Email</Label>
                    <Input
                      id="signup-email"
                      type="email"
                      value={signupData.email}
                      onChange={(e) => updateSignupData('email', e.target.value)}
                      required
                      className={validationErrors.email ? 'border-red-500' : ''}
                    />
                    {validationErrors.email && (
                      <p className="text-red-500 text-xs">{validationErrors.email}</p>
                    )}
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="signup-school">School</Label>
                    <Input
                      id="signup-school"
                      value={signupData.school}
                      onChange={(e) => updateSignupData('school', e.target.value)}
                      required
                      className={validationErrors.school ? 'border-red-500' : ''}
                    />
                    {validationErrors.school && (
                      <p className="text-red-500 text-xs">{validationErrors.school}</p>
                    )}
                  </div>
                  
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Classes ({signupData.classes.length} selected)</Label>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={selectAllClasses}
                          className="text-xs"
                        >
                          All
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={clearAllClasses}
                          className="text-xs"
                        >
                          Clear
                        </Button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 max-h-32 overflow-y-auto p-2 border rounded">
                      {CLASSES.map((className) => (
                        <label key={className} className="flex items-center space-x-2 cursor-pointer hover:bg-gray-50 p-1 rounded">
                          <input
                            type="checkbox"
                            checked={signupData.classes.includes(className)}
                            onChange={() => handleClassToggle(className)}
                            className="rounded"
                          />
                          <span className="text-sm">{className}</span>
                        </label>
                      ))}
                    </div>
                    {signupData.classes.length === 0 && error && (
                      <p className="text-red-500 text-xs">Please select at least one class</p>
                    )}
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="signup-password">Password</Label>
                    <Input
                      id="signup-password"
                      type="password"
                      value={signupData.password}
                      onChange={(e) => updateSignupData('password', e.target.value)}
                      required
                      className={validationErrors.password ? 'border-red-500' : ''}
                    />
                    {validationErrors.password && (
                      <p className="text-red-500 text-xs">{validationErrors.password}</p>
                    )}
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="signup-confirm-password">Confirm Password</Label>
                    <Input
                      id="signup-confirm-password"
                      type="password"
                      value={signupData.confirmPassword}
                      onChange={(e) => updateSignupData('confirmPassword', e.target.value)}
                      required
                      className={validationErrors.confirmPassword ? 'border-red-500' : ''}
                    />
                    {validationErrors.confirmPassword && (
                      <p className="text-red-500 text-xs">{validationErrors.confirmPassword}</p>
                    )}
                  </div>
                  
                  {error && <p className="text-red-500 text-sm">{error}</p>}
                  
                  <Button 
                    type="submit" 
                    className="w-full" 
                    disabled={loading || !isSignupFormValid}
                  >
                    {loading ? 'Creating Account...' : 'Create Account'}
                  </Button>
                  
                  {!isSignupFormValid && (
                    <p className="text-gray-500 text-xs text-center">
                      Please fill all fields correctly to create account
                    </p>
                  )}
                </form>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
