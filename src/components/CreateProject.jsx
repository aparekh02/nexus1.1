import React, { useState, useRef, useEffect } from 'react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Textarea } from './ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { ArrowLeft, Save, FileText, Users, Zap, Upload, Plus, Sparkles, BookOpen, Brain, FileUp, Trash2, Download } from 'lucide-react'
import axios from 'axios'
import { useAuth } from './AuthContext'
import ProjectBoard from './ProjectBoard'

const SUBJECTS = ["Math", "Science", "History", "Art", "Computer Science", "English"]
const ACCESS_LEVELS = [
  { value: 'private', label: 'Private - Only you can see this' },
  { value: 'view_only', label: 'View Only (Coming Soon)', disabled: true },
  { value: 'edit', label: 'Collaborative (Coming Soon)', disabled: true }
]

// Set the base URL for your Flask backend
const API_BASE_URL = 'http://localhost:5001'
axios.defaults.baseURL = API_BASE_URL

export default function CreateProject({ onBack, onProjectCreated }) {
  const { user } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [createdProject, setCreatedProject] = useState(null)
  const [showProjectBoard, setShowProjectBoard] = useState(false)
  const [uploadedFiles, setUploadedFiles] = useState([])
  const [aiGenerating, setAiGenerating] = useState(false)
  const [aiOutput, setAiOutput] = useState('')
  const fileInputRef = useRef(null)

  const [projectData, setProjectData] = useState({
    title: '',
    description: '',
    subject: '',
    access_level: 'private'
  })

  const [aiTools] = useState([
    { name: 'summarize', display_name: 'Summarize Content', icon: BookOpen },
    { name: 'analyze', display_name: 'Analyze Files', icon: Brain },
    { name: 'translate', display_name: 'Translate Text', icon: Sparkles },
    { name: 'extract', display_name: 'Extract Key Points', icon: FileText }
  ])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    setSuccess(false)

    if (!projectData.title.trim() || !projectData.description.trim() || !projectData.subject) {
      setError('Please fill in all required fields')
      setLoading(false)
      return
    }

    try {
      // Send project data to Flask backend using new endpoint
      const response = await axios.post('/api/projects', {
        title: projectData.title.trim(),
        description: projectData.description.trim(),
        subject: projectData.subject,
        access_level: projectData.access_level,
        user_id: user.id || user.user_id || user.email,
        created_at: new Date().toISOString()
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${user.access_token || ''}`
        },
        withCredentials: true
      })

      if (response.data.success) {
        const newProject = response.data.project
        setCreatedProject(newProject)
        setSuccess(true)
        
        // Reset form
        setProjectData({
          title: '',
          description: '',
          subject: '',
          access_level: 'private'
        })

        // Call the parent component's callback if provided
        if (onProjectCreated && typeof onProjectCreated === 'function') {
          onProjectCreated(newProject)
        }
      } else {
        setError(response.data.message || 'Failed to create project. Please try again.')
      }

    } catch (error) {
      console.error('Error creating project:', error)
      
      // Handle different types of errors
      if (error.response) {
        const errorMessage = error.response.data?.error || 
                            error.response.data?.message || 
                            `Server error: ${error.response.status}`
        setError(errorMessage)
      } else if (error.request) {
        setError('Unable to connect to server. Please check if the backend is running.')
      } else {
        setError('Failed to create project. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleInputChange = (field, value) => {
    setProjectData(prev => ({
      ...prev,
      [field]: value
    }))
    // Clear error when user starts typing
    if (error) setError('')
  }

  const handleFileUpload = async (event) => {
    const files = Array.from(event.target.files)
    
    for (const file of files) {
      try {
        const formData = new FormData()
        formData.append('file', file)
        formData.append('project_id', createdProject?.id || 'temp')
        
        const response = await axios.post('/api/files', formData, {
          headers: {
            'Content-Type': 'multipart/form-data'
          },
          withCredentials: true
        })

        if (response.data.success) {
          setUploadedFiles(prev => [...prev, response.data.file])
        }
      } catch (error) {
        console.error('Error uploading file:', error)
        setError(`Failed to upload ${file.name}`)
      }
    }
  }

  const handleDeleteFile = async (fileId) => {
    try {
      const response = await axios.delete(`/api/files/${fileId}`, {
        withCredentials: true
      })

      if (response.data.success) {
        setUploadedFiles(prev => prev.filter(f => f.id !== fileId))
      }
    } catch (error) {
      console.error('Error deleting file:', error)
      setError('Failed to delete file')
    }
  }

  const handleAiToolExecution = async (toolName) => {
    if (!projectData.description.trim() && uploadedFiles.length === 0) {
      setError('Please add some content or upload files before using AI tools')
      return
    }

    setAiGenerating(true)
    setError('')

    try {
      const response = await axios.post('/api/ai-tools/execute', {
        tool_name: toolName,
        input: projectData.description,
        project_id: createdProject?.id || 'temp',
        selected_files: uploadedFiles.map(f => f.id)
      }, {
        withCredentials: true
      })

      if (response.data.success) {
        setAiOutput(response.data.output)
      } else {
        setError('AI tool execution failed')
      }
    } catch (error) {
      console.error('Error executing AI tool:', error)
      setError('Failed to execute AI tool')
    } finally {
      setAiGenerating(false)
    }
  }

  const navigateToProjectBoard = () => {
    if (createdProject) {
      if (onProjectCreated && typeof onProjectCreated === 'function') {
        onProjectCreated(createdProject)
      }
      setShowProjectBoard(true)
    }
  }

  // Show ProjectBoard if user clicked "Open Project Board"
  if (showProjectBoard && createdProject) {
    return (
      <ProjectBoard 
        project={createdProject} 
        onBack={() => setShowProjectBoard(false)}
      />
    )
  }

  if (success) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Card className="w-full max-w-lg">
          <CardContent className="pt-6">
            <div className="text-center">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Save className="h-8 w-8 text-green-600" />
              </div>
              <h2 className="text-xl font-semibold text-gray-900 mb-2">Project Created Successfully!</h2>
              <p className="text-gray-600 mb-6">
                Your project "{createdProject?.title || projectData.title}" has been created and is ready for collaboration.
              </p>
              
              <div className="space-y-3 mb-6">
                <Button 
                  onClick={navigateToProjectBoard}
                  className="w-full bg-orange-600 hover:bg-orange-500"
                >
                  <FileText className="h-4 w-4 mr-2" />
                  Open Project Board
                </Button>
                
                <Button 
                  variant="outline" 
                  onClick={onBack}
                  className="w-full"
                >
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back to Homepage
                </Button>
              </div>
              
              <div className="text-sm text-gray-500 space-y-1">
                <p>In the project board you can:</p>
                <div className="flex items-center justify-center space-x-4 text-xs">
                  <span className="flex items-center">
                    <FileText className="h-3 w-3 mr-1" />
                    Import files
                  </span>
                  <span className="flex items-center">
                    <Users className="h-3 w-3 mr-1" />
                    Collaborate
                  </span>
                  <span className="flex items-center">
                    <Zap className="h-3 w-3 mr-1" />
                    Use AI tools
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <Button 
            variant="ghost" 
            onClick={onBack}
            className="flex items-center"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Homepage
          </Button>
          <h1 className="text-xl font-semibold text-gray-900">Create New Project</h1>
          <div className="w-24"></div> {/* Spacer for centering */}
        </div>
      </div>

      {/* Main Layout - Three Column */}
      <div className="flex h-[calc(100vh-80px)]">
        
        {/* Left Sidebar - File Upload & Management */}
        <div className="w-80 bg-white border-r border-gray-200 p-6 overflow-y-auto">
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                <Upload className="h-5 w-5 mr-2" />
                File Management
              </h3>
              
              <Button
                onClick={() => fileInputRef.current?.click()}
                variant="outline"
                className="w-full mb-4"
              >
                <FileUp className="h-4 w-4 mr-2" />
                Upload Files
              </Button>
              
              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={handleFileUpload}
                className="hidden"
                accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg"
              />
            </div>

            {/* Uploaded Files List */}
            {uploadedFiles.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-gray-700 mb-2">Uploaded Files</h4>
                <div className="space-y-2">
                  {uploadedFiles.map((file) => (
                    <div key={file.id} className="flex items-center justify-between p-2 bg-gray-50 rounded-md">
                      <div className="flex items-center">
                        <FileText className="h-4 w-4 mr-2 text-gray-500" />
                        <span className="text-sm text-gray-700 truncate">{file.name}</span>
                      </div>
                      <div className="flex items-center space-x-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDeleteFile(file.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Project Templates */}
            <div>
              <h4 className="text-sm font-medium text-gray-700 mb-2">Quick Templates</h4>
              <div className="space-y-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start"
                  onClick={() => handleInputChange('description', 'Research project focusing on...')}
                >
                  <BookOpen className="h-4 w-4 mr-2" />
                  Research Project
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start"
                  onClick={() => handleInputChange('description', 'Study group for exam preparation...')}
                >
                  <Users className="h-4 w-4 mr-2" />
                  Study Group
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start"
                  onClick={() => handleInputChange('description', 'Lab report and analysis...')}
                >
                  <FileText className="h-4 w-4 mr-2" />
                  Lab Report
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Center Content - Main Form */}
        <div className="flex-1 p-6 overflow-y-auto">
          <div className="max-w-2xl mx-auto">
            <Card>
              <CardHeader>
                <CardTitle>Project Details</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-6">
                  <div className="space-y-2">
                    <Label htmlFor="title">Project Title *</Label>
                    <Input
                      id="title"
                      value={projectData.title}
                      onChange={(e) => handleInputChange('title', e.target.value)}
                      placeholder="Enter your project title"
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="description">Description *</Label>
                    <Textarea
                      id="description"
                      value={projectData.description}
                      onChange={(e) => handleInputChange('description', e.target.value)}
                      placeholder="Describe your project..."
                      rows={6}
                      required
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="subject">Subject *</Label>
                      <Select 
                        value={projectData.subject} 
                        onValueChange={(value) => handleInputChange('subject', value)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select a subject" />
                        </SelectTrigger>
                        <SelectContent>
                          {SUBJECTS.map((subject) => (
                            <SelectItem key={subject} value={subject}>
                              {subject}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="access_level">Access Level</Label>
                      <Select 
                        value={projectData.access_level} 
                        onValueChange={(value) => handleInputChange('access_level', value)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ACCESS_LEVELS.map((level) => (
                            <SelectItem key={level.value} value={level.value}>
                              {level.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {error && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded-md">
                      <p className="text-red-600 text-sm">{error}</p>
                    </div>
                  )}

                  <div className="flex justify-end space-x-4">
                    <Button 
                      type="button" 
                      variant="outline" 
                      onClick={onBack}
                    >
                      Cancel
                    </Button>
                    <Button 
                      type="submit" 
                      disabled={loading}
                      className="bg-orange-600 hover:bg-blue-700"
                    >
                      {loading ? 'Creating...' : 'Create Project'}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Right Sidebar - AI Tools */}
        <div className="w-80 bg-white border-l border-gray-200 p-6 overflow-y-auto">
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                <Zap className="h-5 w-5 mr-2" />
                AI Assistant
              </h3>
              
              <div className="space-y-3">
                {aiTools.map((tool) => {
                  const IconComponent = tool.icon
                  return (
                    <Button
                      key={tool.name}
                      variant="outline"
                      className="w-full justify-start"
                      onClick={() => handleAiToolExecution(tool.name)}
                      disabled={aiGenerating}
                    >
                      <IconComponent className="h-4 w-4 mr-2" />
                      {tool.display_name}
                    </Button>
                  )
                })}
              </div>

              {aiGenerating && (
                <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-md">
                  <div className="flex items-center">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-orange-600 mr-2"></div>
                    <p className="text-orange-600 text-sm">AI is processing...</p>
                  </div>
                </div>
              )}

              {aiOutput && (
                <div className="mt-4">
                  <h4 className="text-sm font-medium text-gray-700 mb-2">AI Output</h4>
                  <div className="p-3 bg-gray-50 border border-gray-200 rounded-md">
                    <p className="text-sm text-gray-700 whitespace-pre-wrap">{aiOutput}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2 w-full"
                    onClick={() => {
                      const currentDesc = projectData.description
                      const newDesc = currentDesc ? `${currentDesc}\n\n${aiOutput}` : aiOutput
                      handleInputChange('description', newDesc)
                      setAiOutput('')
                    }}
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Add to Description
                  </Button>
                </div>
              )}
            </div>

            {/* AI Suggestions */}
            <div>
              <h4 className="text-sm font-medium text-gray-700 mb-2">Suggestions</h4>
              <div className="space-y-2 text-xs text-gray-600">
                <p>• Upload relevant documents to get better AI insights</p>
                <p>• Use the summarize tool to condense long content</p>
                <p>• Try the analyze tool to identify key concepts</p>
                <p>• Extract key points for quick reference</p>
              </div>
            </div>

            {/* Project Stats */}
            <div>
              <h4 className="text-sm font-medium text-gray-700 mb-2">Project Stats</h4>
              <div className="space-y-2 text-sm text-gray-600">
                <div className="flex justify-between">
                  <span>Files uploaded:</span>
                  <span>{uploadedFiles.length}</span>
                </div>
                <div className="flex justify-between">
                  <span>Description length:</span>
                  <span>{projectData.description.length} chars</span>
                </div>
                <div className="flex justify-between">
                  <span>Subject:</span>
                  <span>{projectData.subject || 'Not selected'}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

