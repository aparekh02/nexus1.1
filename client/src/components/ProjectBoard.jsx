import React, { useState, useRef, useEffect, useCallback } from 'react'
import ReactFlow, {
  addEdge,
  MiniMap,
  Controls,
  Background,
  applyNodeChanges,
  applyEdgeChanges,
} from 'react-flow-renderer'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Textarea } from './ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog'
import { 
  ArrowLeft, 
  Save, 
  FileText, 
  Users, 
  Zap, 
  Upload, 
  Plus, 
  Sparkles, 
  BookOpen, 
  Brain, 
  FileUp, 
  Trash2, 
  Download,
  Settings,
  Play,
  Square,
  Circle,
  MoreHorizontal,
  TestTube,
  FileQuestion,
  Lightbulb,
  Target,
  History,
  Clock,
  Cloud,
  CloudOff
} from 'lucide-react'
import axios from 'axios'
import { useAuth } from './AuthContext'
import Quill from 'quill'
import 'quill/dist/quill.snow.css'

// Set the base URL for your Flask backend
const API_BASE_URL = 'https://nexus-backend-f2td.onrender.com'
axios.defaults.baseURL = API_BASE_URL

// Axios instance pointed to backend Flask API
const api = axios.create({
  baseURL: API_BASE_URL,
})

const shapeTypes = [
  { type: 'rectangle', label: 'Rectangle', icon: Square },
  { type: 'circle', label: 'Circle', icon: Circle },
  { type: 'rounded', label: 'Rounded Rectangle', icon: Square }
]

// Validate nodes to ensure all have numeric { x, y } positions
const validateNodes = (nodes) =>
  nodes.map((n) => ({
    ...n,
    position:
      n.position && typeof n.position.x === 'number' && typeof n.position.y === 'number'
        ? n.position
        : { x: 0, y: 0 },
  }))

// --- Custom Node Component for Tests ---
const TestNodeViewer = ({ data }) => {
  const [questions, setQuestions] = useState([])

  useEffect(() => {
    const parseTestContent = (content) => {
      const parsed = []
      const questionBlocks = content.split(/(?=(?:Q:|\d+\.)\s*)/).filter(Boolean)

      questionBlocks.forEach(block => {
        const questionMatch = block.match(/(?:Q:|\d+\.)\s*(.*?)(?=\n(?:[A-D]\.|\nCorrect Answer:|\nExpected Answer:|$))/s)
        const questionText = questionMatch ? questionMatch[1].trim() : ''

        const options = []
        const optionMatches = block.matchAll(/([A-D]\.)\s*(.*?)(?=\n[A-D]\.|\nCorrect Answer:|\nExpected Answer:|$)/gs)
        for (const match of optionMatches) {
          options.push(`${match[1]} ${match[2].trim()}`)
        }

        const answerMatch = block.match(/(Correct Answer:|Expected Answer:)\s*(.*)/i)
        const answerText = answerMatch ? answerMatch[2].trim() : 'Not provided.'

        if (questionText) {
          parsed.push({
            question: questionText,
            options: options,
            answer: answerText,
          })
        }
      })
      return parsed
    }

    if (data.description) {
      setQuestions(parseTestContent(data.description))
    }
  }, [data.description])

  return (
    <div className="p-4 overflow-y-auto max-h-96">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">
        {data.label || "Generated Test"}
      </h3>
      {questions.length > 0 ? (
        questions.map((q, index) => (
          <Card key={index} className="mb-3">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                Question {index + 1}: {q.question}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {q.options.length > 0 && (
                <div className="space-y-1 mb-2">
                  {q.options.map((option, optIndex) => (
                    <div key={optIndex} className="text-sm text-gray-600">
                      {option}
                    </div>
                  ))}
                </div>
              )}
              <div className="text-sm text-green-600 font-medium">
                Answer: {q.answer}
              </div>
            </CardContent>
          </Card>
        ))
      ) : (
        <p className="text-gray-500 text-sm">
          No test questions to display or content could not be parsed.
        </p>
      )}
    </div>
  )
}

const nodeTypes = {
  testNode: TestNodeViewer,
}

export default function ProjectBoard({ project, onBack }) {
  const { user } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [uploadedFiles, setUploadedFiles] = useState([])
  const [aiGenerating, setAiGenerating] = useState(false)
  const [aiOutput, setAiOutput] = useState('')
  const [selectedNode, setSelectedNode] = useState(null)
  const [nodes, setNodes] = useState([])
  const [edges, setEdges] = useState([])
  const [testModalOpen, setTestModalOpen] = useState(false)
  const [notesLoading, setNotesLoading] = useState(false)
  const [studyGuideLoading, setStudyGuideLoading] = useState(false)
  const [autofillLoading, setAutofillLoading] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [importFiles, setImportFiles] = useState([])
  const [changeHistoryOpen, setChangeHistoryOpen] = useState(false)
  const [quillInitialized, setQuillInitialized] = useState(false)
  
  // New state for individual shape memory
  const [shapeMemory, setShapeMemory] = useState({})
  
  // CRITICAL: Position tracking state - always tracks current positions
  const [nodePositions, setNodePositions] = useState({})
  
  // Backend sync state
  const [syncStatus, setSyncStatus] = useState('idle') // 'idle', 'syncing', 'success', 'error'
  const [lastSyncTime, setLastSyncTime] = useState(null)
  
  const fileInputRef = useRef(null)
  const canvasRef = useRef(null)
  const quillRef = useRef(null)
  const quillEditorRef = useRef(null)

  const [testGenerationConfig, setTestGenerationConfig] = useState({
    name: '',
    questionCount: 5,
    type: 'mcq'
  })

  const [aiTools] = useState([
    { name: 'summarize', display_name: 'Summarize Content', icon: BookOpen },
    { name: 'analyze', display_name: 'Analyze Files', icon: Brain },
    { name: 'translate', display_name: 'Translate Text', icon: Sparkles },
    { name: 'extract', display_name: 'Extract Key Points', icon: FileText }
  ])

  // --- Enhanced Session Storage Functions for Individual Shapes ---
  const saveShapeMemory = useCallback((nodeId, data) => {
    if (!project?.id || !nodeId) return
    
    const memoryKey = `shape_${nodeId}`
    const shapeData = {
      ...data,
      lastModified: new Date().toISOString(),
      nodeId: nodeId
    }
    
    // Save to localStorage with project-specific key
    saveToSessionStorage(project.id, memoryKey, shapeData)
    
    // Update local state
    setShapeMemory(prev => ({
      ...prev,
      [nodeId]: shapeData
    }))
    
    // Log the memory save action
    logChange(project.id, 'shape_memory_saved', `Saved memory for shape "${data.label || nodeId}" - ${Object.keys(data).join(', ')}`)
  }, [project?.id])

  const loadShapeMemory = useCallback((nodeId) => {
    if (!project?.id || !nodeId) return null
    
    const memoryKey = `shape_${nodeId}`
    const savedData = loadFromSessionStorage(project.id, memoryKey)
    
    if (savedData) {
      // Update local state
      setShapeMemory(prev => ({
        ...prev,
        [nodeId]: savedData
      }))
      
      return savedData
    }
    
    return null
  }, [project?.id])

  const loadAllShapeMemories = useCallback(() => {
    if (!project?.id) return
    
    const allMemories = {}
    
    // Load all shape memories for this project
    nodes.forEach(node => {
      const memory = loadShapeMemory(node.id)
      if (memory) {
        allMemories[node.id] = memory
      }
    })
    
    setShapeMemory(allMemories)
  }, [project?.id, nodes, loadShapeMemory])

  // --- Backend Sync Functions ---
  const syncProjectToBackend = useCallback(async () => {
    if (!project?.id || syncStatus === 'syncing') return
    
    setSyncStatus('syncing')
    
    try {
      const projectState = {
        project_id: project.id,
        project_title: project.title,
        project_subject: project.subject,
        nodes: nodes,
        edges: edges,
        shapeMemory: shapeMemory,
        nodePositions: nodePositions,
        changeLogs: getChangeLogs(project.id),
        uploadedFiles: uploadedFiles,
        importFiles: importFiles,
        timestamp: new Date().toISOString()
      }
      
      const response = await api.post('/api/project-state/save', projectState, {})
      
      if (response.data.success) {
        setSyncStatus('success')
        setLastSyncTime(new Date())
        logChange(project.id, 'backend_sync_success', `Project state synced to backend successfully`)
      } else {
        setSyncStatus('error')
        logChange(project.id, 'backend_sync_failed', `Backend sync failed: ${response.data.error || 'Unknown error'}`)
      }
    } catch (error) {
      console.error('Backend sync error:', error)
      setSyncStatus('error')
      logChange(project.id, 'backend_sync_error', `Backend sync error: ${error.message}`)
    }
    
    // Reset sync status after 3 seconds
    setTimeout(() => setSyncStatus('idle'), 3000)
  }, [project?.id, nodes, edges, shapeMemory, nodePositions, uploadedFiles, importFiles, syncStatus])

  const loadProjectFromBackend = useCallback(async () => {
    if (!project?.id) return
    
    try {
      const response = await api.get(`/api/project-state/load/${project.id}`, {})
      
      if (response.data.success && response.data.projectState) {
        const state = response.data.projectState
        
        // Load the project state from backend
        if (state.nodes) setNodes(validateNodes(state.nodes))
        if (state.edges) setEdges(state.edges)
        if (state.shapeMemory) setShapeMemory(state.shapeMemory)
        if (state.nodePositions) setNodePositions(state.nodePositions)
        if (state.uploadedFiles) setUploadedFiles(state.uploadedFiles)
        if (state.importFiles) setImportFiles(state.importFiles)
        
        // Load change logs to local storage
        if (state.changeLogs) {
          saveToSessionStorage(project.id, 'changeLogs', state.changeLogs)
        }
        
        logChange(project.id, 'backend_load_success', `Project state loaded from backend successfully`)
      }
    } catch (error) {
      console.error('Backend load error:', error)
      logChange(project.id, 'backend_load_error', `Backend load error: ${error.message}`)
    }
  }, [project?.id])

  const saveProjectData = useCallback(() => {
    if (!project?.id) return
    
    const projectData = {
      nodes: nodes,
      edges: edges,
      shapeMemory: shapeMemory,
      nodePositions: nodePositions,
      lastSaved: new Date().toISOString()
    }
    
    saveToSessionStorage(project.id, 'projectData', projectData)
    
    // Also save individual shape memories
    Object.keys(shapeMemory).forEach(nodeId => {
      saveShapeMemory(nodeId, shapeMemory[nodeId])
    })
    
    // Log project save action
    logChange(project.id, 'project_saved', `Project saved with ${nodes.length} nodes, ${edges.length} edges, and ${Object.keys(shapeMemory).length} shape memories`)
    
    // Auto-sync to backend after local save
    syncProjectToBackend()
  }, [project?.id, nodes, edges, shapeMemory, nodePositions, saveShapeMemory, syncProjectToBackend])

  const loadProjectData = useCallback(() => {
    if (!project?.id) return
    
    const savedData = loadFromSessionStorage(project.id, 'projectData')
    if (savedData) {
      setNodes(validateNodes(savedData.nodes || []))
      setEdges(savedData.edges || [])
      
      // Load shape memory if available
      if (savedData.shapeMemory) {
        setShapeMemory(savedData.shapeMemory)
      }
      
      // Load node positions if available, otherwise initialize from nodes
      if (savedData.nodePositions) {
        setNodePositions(savedData.nodePositions)
      } else if (savedData.nodes) {
        const positions = {}
        savedData.nodes.forEach(node => {
          positions[node.id] = node.position
        })
        setNodePositions(positions)
      }
      
      logChange(project.id, 'project_loaded', 
        `Project loaded with ${savedData.nodes?.length || 0} nodes and ${savedData.edges?.length || 0} edges`)
    } else {
      // If no local data, try to load from backend
      loadProjectFromBackend()
    }
  }, [project?.id, loadProjectFromBackend])

  // CRITICAL: Always track node positions whenever nodes change
  useEffect(() => {
    const currentPositions = {}
    nodes.forEach(node => {
      currentPositions[node.id] = node.position
    })
    setNodePositions(currentPositions)
  }, [nodes])

  // Auto-save whenever nodes, edges, or shape memory changes (but don't log these auto-saves)
  useEffect(() => {
    if (project?.id && (nodes.length > 0 || edges.length > 0 || Object.keys(shapeMemory).length > 0)) {
      const projectData = {
        nodes: nodes,
        edges: edges,
        shapeMemory: shapeMemory,
        nodePositions: nodePositions,
        lastSaved: new Date().toISOString()
      }
      
      saveToSessionStorage(project.id, 'projectData', projectData)
      
      // Save individual shape memories without logging
      Object.keys(shapeMemory).forEach(nodeId => {
        const memoryKey = `shape_${nodeId}`
        saveToSessionStorage(project.id, memoryKey, shapeMemory[nodeId])
      })
    }
  }, [nodes, edges, shapeMemory, nodePositions, project?.id])

  // Load project data on mount
  useEffect(() => {
    loadProjectData()
  }, [loadProjectData])

  // Load all shape memories when nodes change
  useEffect(() => {
    if (nodes.length > 0) {
      loadAllShapeMemories()
    }
  }, [nodes, loadAllShapeMemories])
  
  // Effect 1: Initialize Quill editor
  useEffect(() => {
    if (quillRef.current && !quillEditorRef.current) {
      quillEditorRef.current = new Quill(quillRef.current, {
        theme: 'snow',
        modules: {
          toolbar: [
            [{ header: [1, 2, false] }],
            ['bold', 'italic', 'underline', 'strike'],
            [{ color: [] }, { background: [] }],
            [{ list: 'ordered' }, { list: 'bullet' }],
            ['clean'],
          ],
        },
      })

      quillEditorRef.current.on('text-change', (delta, oldDelta, source) => {
        if (source === 'user' && selectedNode) {
          const newDescription = quillEditorRef.current.root.innerHTML
          
          // Update node data
          setNodes((nds) =>
            nds.map((n) =>
              n.id === selectedNode.id
                ? { ...n, data: { ...n.data, description: newDescription } }
                : n
            )
          )
          
          // Save to shape memory
          const currentMemory = shapeMemory[selectedNode.id] || {}
          saveShapeMemory(selectedNode.id, {
            ...currentMemory,
            description: newDescription,
            label: selectedNode.data.label
          })
        }
      })
      
      setQuillInitialized(true)
    }
  }, [selectedNode, shapeMemory, saveShapeMemory])

  // Effect 2: Load content into Quill when selectedNode changes
  useEffect(() => {
    if (quillEditorRef.current && quillInitialized && selectedNode && selectedNode.type !== 'testNode') {
      // First try to load from shape memory
      const savedMemory = shapeMemory[selectedNode.id]
      let html = ''
      
      if (savedMemory && savedMemory.description) {
        html = savedMemory.description
      } else {
        // Fallback to node data
        const nodeInState = nodes.find(n => n.id === selectedNode.id)
        html = nodeInState?.data?.description || ''
      }
      
      // Only update if content is different to prevent cursor jumps
      if (quillEditorRef.current.root.innerHTML !== html) {
        // Use a timeout to ensure Quill is fully rendered
        setTimeout(() => {
          try {
            const delta = quillEditorRef.current.clipboard.convert(html)
            quillEditorRef.current.setContents(delta, 'silent')
          } catch (error) {
            console.warn('Error setting Quill content:', error)
            // Fallback to plain text
            quillEditorRef.current.setText(html.replace(/<[^>]*>/g, ''), 'silent')
          }
        }, 100)
      }
    } else if (quillEditorRef.current && quillInitialized && (!selectedNode || selectedNode.type === 'testNode')) {
      quillEditorRef.current.setContents([], 'silent')
    }
  }, [selectedNode, nodes, shapeMemory, quillInitialized])

  // Load project files on component mount
  useEffect(() => {
    if (project?.id) {
      loadProjectFiles()
    }
  }, [project])

  const loadProjectFiles = async () => {
    try {
      const token = localStorage.getItem('jwt_token')
      const response = await axios.get(`/api/files?project_id=${project.id}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })
      if (response.data.success) {
        setUploadedFiles(response.data.files)
      }
    } catch (error) {
      console.error('Error loading project files:', error)
    }
  }

  const handleFileUpload = async (event) => {
    const files = Array.from(event.target.files)
    
    for (const file of files) {
      try {
        const formData = new FormData()
        formData.append('file', file)
        formData.append('project_id', project.id)
        
        const token = localStorage.getItem('jwt_token')
        const response = await axios.post('/api/files', formData, {
          headers: {
            'Content-Type': 'multipart/form-data',
            'Authorization': `Bearer ${token}`
          }
        })

        if (response.data.success) {
          setUploadedFiles(prev => [...prev, response.data.file])
          
          // Log file upload action
          logChange(project.id, 'file_uploaded', `Uploaded file: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`)
        }
      } catch (error) {
        console.error('Error uploading file:', error)
        setError(`Failed to upload ${file.name}`)
      }
    }
  }

  const onFileChange = async (e) => {
    const files = Array.from(e.target.files)
    const newFiles = []
    setError('') // Clear any previous errors
    
    for (const f of files) {
      const meta = { file: f, type: 'test', id: `${Date.now()}-${f.name}` }
      const form = new FormData()
      form.append('file', f)
      form.append('type', 'test')
      form.append('project_id', project.id)
      
      try {
        setLoading(true) // Show loading state
        const token = localStorage.getItem('jwt_token')
        const res = await api.post('/import-file', form, { 
          headers: {
            'Authorization': `Bearer ${token}`
          }
        })
        console.log('File uploaded and text extracted:', res.data)
        
        // Check if the response has the expected structure
        if (res.data && res.data.success) {
          newFiles.push({ 
            ...meta, 
            database_record_id: res.data.database_record_id,
            file_id: res.data.file_id,
            storage_type: res.data.storage_type || 'database',
            extracted_text_length: res.data.extracted_text_length,
            compressed_text_length: res.data.compressed_text_length,
            structured_items: res.data.structured_items
          })
          
          // Log successful file import with processing details
          const processingInfo = res.data.structured_items ? 
            `(${res.data.structured_items.terms} terms, ${res.data.structured_items.definitions} definitions, ${res.data.structured_items.examples} examples)` : 
            ''
          logChange(project.id, 'file_imported', `Imported and processed file: ${f.name} (${(f.size / 1024).toFixed(1)} KB) ${processingInfo}`)
        } else {
          // Handle case where success is false or missing
          const errorMsg = res.data?.error || `Upload failed for ${f.name}: Invalid response format`
          console.error('Upload error:', errorMsg)
          setError(errorMsg)
          
          // Log failed file import
          logChange(project.id, 'file_import_failed', `Failed to import file: ${f.name} - ${errorMsg}`)
        }
      } catch (err) {
        console.error('Upload failed for ' + f.name + ':', err)
        
        // Extract error message from response if available
        let errorMessage = `Upload failed for ${f.name}`
        if (err.response?.data?.error) {
          errorMessage = err.response.data.error
        } else if (err.message) {
          errorMessage = `Upload failed for ${f.name}: ${err.message}`
        }
        
        setError(errorMessage)
        
        // Log failed file import
        logChange(project.id, 'file_import_failed', `Failed to import file: ${f.name} - ${errorMessage}`)
      } finally {
        setLoading(false) // Hide loading state
      }
    }
    
    if (newFiles.length > 0) {
      setImportFiles((prev) => [...prev, ...newFiles])
      setError('') // Clear error if at least one file was successful
    }
  }

  const setFileType = (id, type) => {
    setImportFiles((f) => f.map((fi) => (fi.id === id ? { ...fi, type } : fi)))
    
    // Log file type change
    const fileName = importFiles.find(file => file.id === id)?.file?.name || 'Unknown file'
    logChange(project.id, 'file_type_changed', `Changed file type for "${fileName}" to "${type}"`)
  }

  const handleDeleteFile = async (fileId) => {
    try {
      const fileToDelete = uploadedFiles.find(f => f.id === fileId)
      const fileName = fileToDelete?.filename || 'Unknown file'
      
              const token = localStorage.getItem('jwt_token')
        const response = await axios.delete(`/api/files/${fileId}`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        })

      if (response.data.success) {
        setUploadedFiles(prev => prev.filter(f => f.id !== fileId))
        
        // Log file deletion
        logChange(project.id, 'file_deleted', `Deleted file: ${fileName}`)
      }
    } catch (error) {
      console.error('Error deleting file:', error)
      setError('Failed to delete file')
    }
  }

  const handleAiToolExecution = async (toolName) => {
    if (uploadedFiles.length === 0 && !selectedNode) {
      setError('Please upload files or select a node before using AI tools')
      return
    }

    setAiGenerating(true)
    setError('')

    try {
      const token = localStorage.getItem('jwt_token')
      const response = await axios.post('/api/ai-tools/execute', {
        tool_name: toolName,
        input: selectedNode?.data?.description || project.description,
        project_id: project.id,
        selected_files: uploadedFiles.map(f => f.id)
      }, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      if (response.data.success) {
        setAiOutput(response.data.output)
        
        // Log AI tool execution
        logChange(project.id, 'ai_tool_executed', `Executed AI tool: ${toolName} ${selectedNode ? `on node "${selectedNode.data.label}"` : 'on project'}`)
      } else {
        setError('AI tool execution failed')
        
        // Log AI tool failure
        logChange(project.id, 'ai_tool_failed', `AI tool execution failed: ${toolName}`)
      }
    } catch (error) {
      console.error('Error executing AI tool:', error)
      setError('Failed to execute AI tool')
      
      // Log AI tool error
      logChange(project.id, 'ai_tool_error', `AI tool error: ${toolName} - ${error.message}`)
    } finally {
      setAiGenerating(false)
    }
  }

  const addShape = (type) => {
    const newNodeId = `${Date.now()}`
    const newPosition = { 
      x: Math.random() * 300 + 50, 
      y: Math.random() * 300 + 50 
    }
    const newNode = {
      id: newNodeId,
      type: 'default',
      data: { 
        label: type.charAt(0).toUpperCase() + type.slice(1), 
        description: '',
        aiSummary: ''
      },
      position: newPosition,
      style: {
        background: '#3b82f6',
        border: '2px solid #1d4ed8',
        borderRadius: type === 'circle' ? '50%' : type === 'rounded' ? '20px' : '4px',
        width: type === 'circle' ? 80 : 120,
        height: type === 'circle' ? 80 : 60,
        color: 'white',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer'
      }
    }
    
    setNodes(prev => validateNodes([...prev, newNode]))
    
    // Initialize shape memory for new node with position
    saveShapeMemory(newNodeId, {
      label: newNode.data.label,
      description: '',
      aiSummary: '',
      createdAt: new Date().toISOString(),
      position: newPosition
    })
    
    // Log shape creation with position
    logChange(project.id, 'shape_created', `Created ${type} shape "${newNode.data.label}" at position (${Math.round(newPosition.x)}, ${Math.round(newPosition.y)})`)
  }

  const onConnect = (params) => {
    setEdges((eds) => addEdge(params, eds))
    
    // Log edge creation
    logChange(project.id, 'connection_created', `Connected node ${params.source} to node ${params.target}`)
  }

  const onNodesChange = useCallback(
    (changes) => {
      setNodes((nds) => {
        const newNodes = validateNodes(applyNodeChanges(changes, nds))
        
        // Process each change to detect movements and other actions
        changes.forEach(change => {
          if (change.type === 'remove') {
            const nodeToDelete = nds.find(n => n.id === change.id)
            const nodeLabel = nodeToDelete?.data?.label || change.id
            const nodePosition = nodePositions[change.id] || { x: 0, y: 0 }
            
            logChange(project.id, 'node_deleted', `Deleted node "${nodeLabel}" at position (${Math.round(nodePosition.x)}, ${Math.round(nodePosition.y)})`)
            
            // Clean up shape memory for deleted node
            if (shapeMemory[change.id]) {
              const newMemory = { ...shapeMemory }
              delete newMemory[change.id]
              setShapeMemory(newMemory)
              // Also remove from localStorage
              const memoryKey = `shape_${change.id}`
              localStorage.removeItem(getStorageKey(project.id, memoryKey))
            }
            
          } else if (change.type === 'position' && change.position && change.dragging === false) {
            // CRITICAL: Only log position changes when dragging is complete
            const node = nds.find(n => n.id === change.id)
            const nodeLabel = node?.data?.label || change.id
            const previousPos = nodePositions[change.id]
            
            // Only log if the position has actually changed significantly
            if (previousPos) {
              const hasPositionChanged = 
                Math.abs(change.position.x - previousPos.x) > 2 || 
                Math.abs(change.position.y - previousPos.y) > 2
              
              if (hasPositionChanged) {
                logChange(project.id, 'node_moved', 
                  `Moved node "${nodeLabel}" from (${Math.round(previousPos.x)}, ${Math.round(previousPos.y)}) to (${Math.round(change.position.x)}, ${Math.round(change.position.y)})`)
                
                // Update shape memory with new position
                const currentMemory = shapeMemory[change.id] || {}
                saveShapeMemory(change.id, {
                  ...currentMemory,
                  position: change.position,
                  lastMoved: new Date().toISOString()
                })
              }
            } else {
              // First time tracking this node
              logChange(project.id, 'node_positioned', 
                `Node "${nodeLabel}" positioned at (${Math.round(change.position.x)}, ${Math.round(change.position.y)})`)
            }
            
          } else if (change.type === 'dimensions' && change.dimensions) {
            const node = nds.find(n => n.id === change.id)
            const nodeLabel = node?.data?.label || change.id
            logChange(project.id, 'node_resized', 
              `Resized node "${nodeLabel}" to ${Math.round(change.dimensions.width)}x${Math.round(change.dimensions.height)}`)
          }
        })
        
        return newNodes
      })
    },
    [setNodes, project?.id, shapeMemory, nodePositions, saveShapeMemory]
  )

  const onEdgesChange = useCallback(
    (changes) => {
      setEdges((eds) => {
        const newEdges = applyEdgeChanges(changes, eds)
        
        // Log edge changes
        changes.forEach(change => {
          if (change.type === 'remove') {
            const edgeToDelete = eds.find(e => e.id === change.id)
            logChange(project.id, 'connection_deleted', `Deleted connection from ${edgeToDelete?.source} to ${edgeToDelete?.target}`)
          }
        })
        
        return newEdges
      })
    },
    [setEdges, project?.id]
  )

  const onNodeClick = useCallback((_, node) => {
    // Load shape memory when node is clicked
    const savedMemory = loadShapeMemory(node.id)
    
    if (savedMemory) {
      // Update node with saved memory data
      setNodes(prev => prev.map(n => 
        n.id === node.id 
          ? { 
              ...n, 
              data: { 
                ...n.data, 
                label: savedMemory.label || n.data.label,
                description: savedMemory.description || n.data.description,
                aiSummary: savedMemory.aiSummary || n.data.aiSummary
              } 
            }
          : n
      ))
    }
    
    setSelectedNode(node)
    
    // Log node selection with current position
    const position = nodePositions[node.id] || node.position
    logChange(project.id, 'node_selected', `Selected node "${node.data.label || node.id}" at position (${Math.round(position.x)}, ${Math.round(position.y)})`)
  }, [loadShapeMemory, project?.id, nodePositions])

  const updateNodeLabel = (e) => {
    if (!selectedNode) return
    const val = e.target.value
    const oldLabel = selectedNode.data.label
    
    setNodes(prev => prev.map(n => 
      n.id === selectedNode.id 
        ? { ...n, data: { ...n.data, label: val } }
        : n
    ))
    
    // Save to shape memory
    const currentMemory = shapeMemory[selectedNode.id] || {}
    saveShapeMemory(selectedNode.id, {
      ...currentMemory,
      label: val
    })
    
    // Log label change only if it's actually different
    if (oldLabel !== val && val.trim() !== '') {
      logChange(project.id, 'node_label_updated', `Updated node label from "${oldLabel || 'Untitled'}" to "${val}"`)
    }
  }

  const deleteSelectedNode = () => {
    if (!selectedNode) return
    const nodeIdToDelete = selectedNode.id
    const nodeLabel = selectedNode.data.label || nodeIdToDelete
    const nodePosition = nodePositions[nodeIdToDelete] || selectedNode.position

    setNodes((nds) => nds.filter((n) => n.id !== nodeIdToDelete))
    setEdges((eds) => eds.filter((e) => e.source !== nodeIdToDelete && e.target !== nodeIdToDelete))
    
    // Clean up shape memory
    if (shapeMemory[nodeIdToDelete]) {
      const newMemory = { ...shapeMemory }
      delete newMemory[nodeIdToDelete]
      setShapeMemory(newMemory)
      // Also remove from localStorage
      const memoryKey = `shape_${nodeIdToDelete}`
      localStorage.removeItem(getStorageKey(project.id, memoryKey))
    }
    
    // Log node deletion with position
    logChange(project.id, 'node_deleted', `Deleted node "${nodeLabel}" at position (${Math.round(nodePosition.x)}, ${Math.round(nodePosition.y)}) and its connections`)
    setSelectedNode(null)
  }

  const runAIArrange = async () => {
    if (!importFiles.length) {
      alert("Please import files first for AI arrangement.")
      return
    }
    setAiLoading(true)
    try {
      // Since files are now stored in database, just send file metadata
      const files = importFiles.map(f => ({ 
        fileName: f.file.name, 
        type: f.type, 
        database_record_id: f.database_record_id,
        storage_type: f.storage_type || 'database'
      })) 
      const token = localStorage.getItem('jwt_token')
      const res = await api.post('/ai-arrange', { files }, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })
      
      const newNodes = validateNodes(res.data.nodes)
      setNodes(newNodes)
      setEdges(res.data.edges)
      setSelectedNode(null)
      
      // Log AI arrangement
      logChange(project.id, 'ai_arrange_completed', `AI arranged ${res.data.nodes.length} nodes and ${res.data.edges.length} connections from ${files.length} database-stored files`)
      
      alert("AI arrangement complete!")
    } catch (err) {
      console.error('AI arrange request failed:', err)
      alert("AI Arrange failed. Check console for details.")
      
      // Log AI arrangement failure
      logChange(project.id, 'ai_arrange_failed', `AI arrangement failed: ${err.message}`)
    }
    setAiLoading(false)
  }

  const handleOpenTestModal = () => {
    setTestModalOpen(true)
    setTestGenerationConfig({ name: '', questionCount: 5, type: 'mcq' })
  }

  const handleCloseTestModal = () => {
    setTestModalOpen(false)
  }

  const handleTestConfigChange = (field, value) => {
    setTestGenerationConfig((prev) => ({ ...prev, [field]: value }))
  }

  const generateTest = async () => {
    const availableTestSources = importFiles.filter(f => f.type === 'test')
    const availablePracticeSources = importFiles.filter(f => f.type === 'practice')
    const availableNotesSources = importFiles.filter(f => f.type === 'notes')

    if (availableTestSources.length === 0 && availablePracticeSources.length === 0 && availableNotesSources.length === 0) {
      console.warn("No suitable files (tests, practice, or notes) found to generate a test.")
      alert("Please upload 'test', 'practice', or 'notes' files to generate a test.")
      handleCloseTestModal()
      return
    }

    setLoading(true)
    try {
      const token = localStorage.getItem('jwt_token')
      // The backend now gets data from database based on JWT user, no need to pass file paths
      const res = await api.post('/generate-test', { 
        config: testGenerationConfig
      }, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })
      const testContent = res.data.testContent

      const testPosition = { x: Math.random() * 300 + 50, y: Math.random() * 300 + 50 }
      const newTestNode = {
        id: `test-${Date.now()}`,
        type: 'testNode',
        data: {
          label: `${testGenerationConfig.name || 'Generated Test'} (${testGenerationConfig.type.toUpperCase()}, ${testGenerationConfig.questionCount} Qs)`,
          description: testContent,
        },
        position: testPosition,
        style: { 
          backgroundColor: '#dc2626', 
          border: '2px solid #b91c1c', 
          width: 200, 
          height: 100,
          borderRadius: '8px',
          color: 'white',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer'
        },
      }
      setNodes((nds) => validateNodes([...nds, newTestNode]))
      
      setTestModalOpen(false)
      
      // Log test generation with position
      const availableFiles = availableTestSources.length + availablePracticeSources.length + availableNotesSources.length
      logChange(project.id, 'test_generated', `Generated ${testGenerationConfig.type.toUpperCase()} test "${testGenerationConfig.name}" with ${testGenerationConfig.questionCount} questions using ${availableFiles} database-stored files at position (${Math.round(testPosition.x)}, ${Math.round(testPosition.y)})`)
      
      alert("Test Generated! Check the new node on the canvas.")
    } catch (err) {
      console.error('Test generation failed:', err)
      alert("Test generation failed. Check console for details.")
      
      // Log test generation failure
      logChange(project.id, 'test_generation_failed', `Test generation failed: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  const handleExport = () => {
    const data = {
      nodes: nodes,
      edges: edges,
      uploadedFiles: uploadedFiles,
      projectDetails: project,
      shapeMemory: shapeMemory,
      nodePositions: nodePositions,
      changeLogs: getChangeLogs(project.id)
    }
    const filename = `project_board_${project.title.replace(/\s/g, ".")}.json`
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    
    // Log project export
    logChange(project.id, "project_exported", `Project data exported to ${filename} (${(blob.size / 1024).toFixed(1)} KB)`)
  }

  const canGenerateTest = importFiles.some(f => f.type === 'test' || f.type === 'practice' || f.type === 'notes')

  const developNotes = async () => {
    if (!selectedNode) {
      alert("Please select a shape to develop notes for.")
      return
    }
    setNotesLoading(true)
    try {
      const topic = selectedNode.data.label
      const existingContent = selectedNode.data.description || ''

      const token = localStorage.getItem('jwt_token')
      // Backend now gets user's processed files from database based on JWT
      const notesRes = await api.post('/generate-notes', { 
        topic: topic, 
        existingContent: existingContent
      }, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })
      
      const newNotes = notesRes.data.notesContent
      setNodes((nds) =>
        nds.map((n) =>
          n.id === selectedNode.id
            ? { ...n, data: { ...n.data, description: newNotes } }
            : n
        )
      )
      
      // Save to shape memory
      const currentMemory = shapeMemory[selectedNode.id] || {}
      saveShapeMemory(selectedNode.id, {
        ...currentMemory,
        description: newNotes
      })
      
      // Log notes development
      logChange(project.id, 'notes_developed', `Developed notes for node "${topic}" using database-stored processed files`)
      
      alert("Notes developed successfully!")
    } catch (err) {
      console.error('Develop notes failed:', err)
      alert("Develop notes failed. Check console for details.")
      
      // Log notes development failure
      logChange(project.id, 'notes_development_failed', `Notes development failed for node "${selectedNode.data.label}": ${err.message}`)
    }
    setNotesLoading(false)
  }

  const generateStudyGuide = async () => {
    if (nodes.length === 0 && importFiles.length === 0) {
      alert("Please add shapes or import files to generate a study guide.")
      return
    }
    setStudyGuideLoading(true)
    try {
      const topics = nodes.map(n => n.data.label).filter(Boolean)

      const token = localStorage.getItem('jwt_token')
      // Backend now gets user's processed files from database based on JWT
      const res = await api.post('/generate-study-guide', { 
        topics: topics
      }, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })
      
      const newNodes = validateNodes(res.data.nodes)
      setNodes(newNodes)
      setEdges(res.data.edges)
      setSelectedNode(null)
      
      // Log study guide generation
      logChange(project.id, 'study_guide_generated', `Generated study guide with ${res.data.nodes.length} nodes and ${res.data.edges.length} connections from ${topics.length} topics using database-stored files`)
      
      alert("Study Guide Generated! Check the new layout on the canvas.")
    } catch (err) {
      console.error('Generate study guide failed:', err)
      alert("Generate study guide failed. Check console for details.")
      
      // Log study guide generation failure
      logChange(project.id, 'study_guide_generation_failed', `Study guide generation failed: ${err.message}`)
    }
    setStudyGuideLoading(false)
  }

  const autofillInformation = async () => {
    if (!selectedNode) {
      alert("Please select a shape to autofill information for.")
      return
    }
    setAutofillLoading(true)
    try {
      const topic = selectedNode.data.label

      const token = localStorage.getItem('jwt_token')
      // Backend now gets user's processed files from database based on JWT
      const res = await api.post("/autofill-info", { 
        topic: topic, 
        existingContent: selectedNode.data.description || ''
      }, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      const summary = res.data.filledContent
      setNodes(prev => prev.map(n => 
        n.id === selectedNode.id 
          ? { ...n, data: { ...n.data, aiSummary: summary } }
          : n
      ))
      
      // Save to shape memory
      const currentMemory = shapeMemory[selectedNode.id] || {}
      saveShapeMemory(selectedNode.id, {
        ...currentMemory,
        aiSummary: summary
      })
      
      // Log autofill action
      logChange(project.id, 'ai_autofill_completed', `Generated AI summary for node "${topic}" using database-stored processed files`)
      
      alert("AI Summary generated!")
    } catch (err) {
      console.error('Autofill information failed:', err)
      alert("Autofill failed.")
      setNodes(prev => prev.map(n => 
        n.id === selectedNode.id 
          ? { ...n, data: { ...n.data, aiSummary: 'Autofill failed.' } }
          : n
      ))
      
      // Log autofill failure
      logChange(project.id, 'ai_autofill_failed', `AI autofill failed for node "${selectedNode.data.label}": ${err.message}`)
    }
    setAutofillLoading(false)
  }

  // Get the current selected node from the main nodes array for fresh data
  const currentSelectedNode = nodes.find(n => n.id === selectedNode?.id)
  
  // Get shape memory for current selected node
  const currentShapeMemory = selectedNode ? shapeMemory[selectedNode.id] : null

  // Sync status icon and color
  const getSyncStatusIcon = () => {
    switch (syncStatus) {
      case 'syncing':
        return <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-orange-600"></div>
      case 'success':
        return <Cloud className="h-4 w-4 text-green-600" />
      case 'error':
        return <CloudOff className="h-4 w-4 text-red-600" />
      default:
        return <Cloud className="h-4 w-4 text-gray-400" />
    }
  }

  const getSyncStatusText = () => {
    switch (syncStatus) {
      case 'syncing':
        return 'Syncing...'
      case 'success':
        return lastSyncTime ? `Synced ${lastSyncTime.toLocaleTimeString()}` : 'Synced'
      case 'error':
        return 'Sync failed'
      default:
        return 'Not synced'
    }
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
            Back to Projects
          </Button>
          <div className="text-center">
            <h1 className="text-xl font-semibold text-gray-900">{project.title}</h1>
            <p className="text-sm text-gray-500">{project.subject}</p>
          </div>
          <div className="flex items-center space-x-2">
            {/* Sync Status Indicator */}
            <div className="flex items-center space-x-1 px-2 py-1 bg-gray-50 rounded-md">
              {getSyncStatusIcon()}
              <span className="text-xs text-gray-600">{getSyncStatusText()}</span>
            </div>
            
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => setChangeHistoryOpen(true)}
            >
              <History className="h-4 w-4 mr-1" />
              History
            </Button>
            <Button variant="outline" size="sm">
              <Settings className="h-4 w-4 mr-1" />
              Settings
            </Button>
            <Button size="sm" onClick={handleExport}>
              <Download className="h-4 w-4 mr-1" />
              Export
            </Button>
          </div>
        </div>
      </div>

      {/* Main Layout - Three Column */}
      <div className="flex h-[calc(100vh-80px)]">
        
        {/* Left Sidebar - File Upload & Shape Tools */}
        <div className="w-80 bg-white border-r border-gray-200 p-6 overflow-y-auto">
          <div className="space-y-6">
            {/* File Management */}
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                <Upload className="h-5 w-5 mr-2" />
                Import Materials
              </h3>
              
              {/* Error Display */}
              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
                  <p className="text-red-600 text-sm">{error}</p>
                </div>
              )}
              
              <Button
                onClick={() => fileInputRef.current?.click()}
                variant="outline"
                className="w-full mb-4 h-20 border-dashed border-2"
                disabled={loading}
              >
                <div className="text-center">
                  <FileUp className="h-6 w-6 mx-auto mb-1" />
                  <span className="text-sm">
                    {loading ? 'Processing...' : 'Click to import files'}
                  </span>
                </div>
              </Button>
              
              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={onFileChange}
                className="hidden"
                accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg"
              />
            </div>

            {/* Uploaded Files List */}
            {importFiles.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-gray-700 mb-2">Imported Files</h4>
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {importFiles.map((file) => (
                    <div key={file.id} className="flex items-center justify-between p-2 bg-gray-50 rounded-md">
                      <div className="flex items-center">
                        <FileText className="h-4 w-4 mr-2 text-gray-500" />
                        <div className="flex flex-col">
                          <span className="text-sm text-gray-700 truncate">{file.file.name}</span>
                          <Select value={file.type} onValueChange={(value) => setFileType(file.id, value)}>
                            <SelectTrigger className="w-20 h-6 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="test">Test</SelectItem>
                              <SelectItem value="practice">Practice</SelectItem>
                              <SelectItem value="notes">Notes</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Add Shapes */}
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                <Plus className="h-5 w-5 mr-2" />
                Add Shapes
              </h3>
              
              <div className="space-y-2">
                {shapeTypes.map((shape) => {
                  const IconComponent = shape.icon
                  return (
                    <Button
                      key={shape.type}
                      variant="outline"
                      className="w-full justify-start"
                      onClick={() => addShape(shape.type)}
                    >
                      <IconComponent className="h-4 w-4 mr-2" />
                      {shape.label}
                    </Button>
                  )
                })}
              </div>
            </div>

            {/* AI Canvas Tools */}
            <div>
              <h4 className="text-sm font-medium text-gray-700 mb-2">AI Canvas Tools</h4>
              <div className="space-y-2">
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  onClick={generateStudyGuide}
                  disabled={studyGuideLoading || (nodes.length === 0 && importFiles.length === 0)}
                >
                  {studyGuideLoading ? (
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-orange-600 mr-2"></div>
                  ) : (
                    <Target className="h-4 w-4 mr-2" />
                  )}
                  {studyGuideLoading ? 'Generating Guide...' : 'Generate Study Guide'}
                </Button>
              </div>
            </div>

            {/* AI Tools */}
            <div>
              <h4 className="text-sm font-medium text-gray-700 mb-2">AI Tools</h4>
              <div className="space-y-2">
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
                <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-md">
                  <h5 className="text-sm font-medium text-green-700 mb-2">AI Output</h5>
                  <div className="text-sm text-green-600 whitespace-pre-wrap max-h-40 overflow-y-auto">
                    {aiOutput}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Center - Canvas */}
        <div className="flex-1 relative">
          <ReactFlow
            ref={canvasRef}
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            nodeTypes={nodeTypes}
            fitView
            className="bg-gray-100"
          >
            <Background />
            <Controls />
            <MiniMap />
          </ReactFlow>
        </div>

        {/* Right Sidebar - Node Details */}
        <div className="w-80 bg-white border-l border-gray-200 p-6 overflow-y-auto">
          <div className="space-y-6">
            {currentSelectedNode ? (
              currentSelectedNode.type === 'testNode' ? (
                <TestNodeViewer data={currentSelectedNode.data} />
              ) : (
                <>
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Edit Shape</h3>
                    
                    <div className="space-y-4">
                      <div>
                        <Label htmlFor="node-title">Title</Label>
                        <Input
                          id="node-title"
                          value={currentSelectedNode.data.label || ''}
                          onChange={updateNodeLabel}
                          placeholder="Enter title"
                        />
                      </div>
                      
                      <div>
                        <Label htmlFor="node-description">Information</Label>
                        <div
                          ref={quillRef}
                          className="min-h-[200px] border border-gray-300 rounded-md"
                        />
                      </div>
                      
                      <Button
                        variant="destructive"
                        onClick={deleteSelectedNode}
                        className="w-full"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete Shape
                      </Button>
                    </div>
                  </div>

                  {/* Shape Memory Info Panel */}
                  {currentShapeMemory && (
                    <div className="bg-gray-50 border border-gray-200 rounded-md p-3">
                      <h4 className="text-sm font-medium text-gray-700 mb-2 flex items-center">
                        <Clock className="h-4 w-4 mr-1" />
                        Shape Memory
                      </h4>
                      <div className="text-xs text-gray-600 space-y-1">
                        {currentShapeMemory.createdAt && (
                          <div>Created: {new Date(currentShapeMemory.createdAt).toLocaleString()}</div>
                        )}
                        {currentShapeMemory.lastModified && (
                          <div>Modified: {new Date(currentShapeMemory.lastModified).toLocaleString()}</div>
                        )}
                        {currentShapeMemory.lastMoved && (
                          <div>Last Moved: {new Date(currentShapeMemory.lastMoved).toLocaleString()}</div>
                        )}
                        {(currentShapeMemory.position || nodePositions[selectedNode.id]) && (
                          <div>Position: ({Math.round((currentShapeMemory.position || nodePositions[selectedNode.id]).x)}, {Math.round((currentShapeMemory.position || nodePositions[selectedNode.id]).y)})</div>
                        )}
                        <div className="flex flex-wrap gap-1 mt-2">
                          {currentShapeMemory.description && (
                            <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs">Description</span>
                          )}
                          {currentShapeMemory.aiSummary && (
                            <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs">AI Summary</span>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* AI Tools for Selected Node */}
                  <div>
                    <h4 className="text-sm font-medium text-gray-700 mb-2">AI Tools (Selected Node)</h4>
                    <div className="space-y-2">
                      <Button
                        variant="outline"
                        className="w-full justify-start"
                        onClick={autofillInformation}
                        disabled={!currentSelectedNode || autofillLoading}
                      >
                        {autofillLoading ? (
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-orange-600 mr-2"></div>
                        ) : (
                          <Lightbulb className="h-4 w-4 mr-2" />
                        )}
                        {autofillLoading ? 'Autofilling...' : 'Autofill Information'}
                      </Button>

                      {(currentSelectedNode.data.aiSummary || currentShapeMemory?.aiSummary) && (
                        <div className="mt-3 p-3 bg-gray-50 border border-gray-200 rounded-md">
                          <h5 className="text-sm font-medium text-gray-700 mb-2">AI Summary</h5>
                          <div className="text-sm text-gray-600 whitespace-pre-wrap">
                            {(currentShapeMemory?.aiSummary || currentSelectedNode.data.aiSummary || '').split('\n').map((point, idx) => (
                              <div key={idx}>• {point}</div>
                            ))}
                          </div>
                        </div>
                      )}

                      <Button
                        variant="outline"
                        className="w-full justify-start"
                        onClick={developNotes}
                        disabled={!currentSelectedNode || notesLoading}
                      >
                        {notesLoading ? (
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-orange-600 mr-2"></div>
                        ) : (
                          <FileText className="h-4 w-4 mr-2" />
                        )}
                        {notesLoading ? 'Developing Notes...' : 'Develop Notes'}
                      </Button>
                    </div>
                  </div>
                </>
              )
            ) : (
              <div className="text-center text-gray-500">
                <p className="text-sm">Click a shape to view/edit its details.</p>
                <p className="text-xs mt-2">Each shape now has persistent memory that saves your information automatically.</p>
              </div>
            )}

            {/* Test Generation Section */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-medium text-gray-700">Generate New Test</h4>
                <Button
                  size="sm"
                  onClick={handleOpenTestModal}
                  disabled={!canGenerateTest}
                >
                  <TestTube className="h-4 w-4 mr-1" />
                  New Test
                </Button>
              </div>
              {!canGenerateTest && (
                <p className="text-xs text-gray-500">
                  Upload 'test', 'practice', or 'notes' files to enable test generation.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Test Generation Modal */}
      <Dialog open={testModalOpen} onOpenChange={setTestModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate New Test</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="test-name">Test Name</Label>
              <Input
                id="test-name"
                value={testGenerationConfig.name}
                onChange={(e) => handleTestConfigChange('name', e.target.value)}
                placeholder="Enter test name"
              />
            </div>
            <div>
              <Label htmlFor="question-count">Number of Questions</Label>
              <Input
                id="question-count"
                type="number"
                min="1"
                max="100"
                value={testGenerationConfig.questionCount}
                onChange={(e) => handleTestConfigChange('questionCount', parseInt(e.target.value))}
              />
            </div>
            <div>
              <Label>Question Type</Label>
              <Select value={testGenerationConfig.type} onValueChange={(value) => handleTestConfigChange('type', value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mcq">Multiple Choice</SelectItem>
                  <SelectItem value="frq">Free Response</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end space-x-2">
              <Button variant="outline" onClick={handleCloseTestModal}>
                Cancel
              </Button>
              <Button onClick={generateTest} disabled={loading}>
                {loading ? 'Generating...' : 'Generate Test'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Change History Modal */}
      <ChangeHistoryViewer 
        projectId={project.id}
        isOpen={changeHistoryOpen}
        onClose={() => setChangeHistoryOpen(false)}
      />

      {/* Error Display */}
      {error && (
        <div className="fixed bottom-4 right-4 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      )}
    </div>
  )
}

// --- Session Storage Helper Functions ---
const getStorageKey = (projectId, key) => `project_${projectId}_${key}`

const saveToSessionStorage = (projectId, key, data) => {
  try {
    const storageKey = getStorageKey(projectId, key)
    localStorage.setItem(storageKey, JSON.stringify(data))
    return true
  } catch (error) {
    console.error("Error saving to localStorage:", error)
    return false
  }
}

const loadFromSessionStorage = (projectId, key, defaultValue = null) => {
  try {
    const storageKey = getStorageKey(projectId, key)
    const stored = localStorage.getItem(storageKey)
    return stored ? JSON.parse(stored) : defaultValue
  } catch (error) {
    console.error("Error loading from localStorage:", error)
    return defaultValue
  }
}

// --- Optimized Change Logging Functions (Event-Driven Only) ---
const logChange = (projectId, action, details) => {
  const timestamp = new Date().toISOString()
  const changeEntry = {
    id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    timestamp,
    action,
    details,
    user: 'current_user' // You can replace this with actual user info
  }
  
  const existingLogs = loadFromSessionStorage(projectId, 'changeLogs', [])
  const updatedLogs = [...existingLogs, changeEntry]
  
  // Keep only the last 1000 changes to prevent storage overflow
  const trimmedLogs = updatedLogs.slice(-1000)
  
  saveToSessionStorage(projectId, 'changeLogs', trimmedLogs)
  return changeEntry
}

const getChangeLogs = (projectId) => {
  return loadFromSessionStorage(projectId, 'changeLogs', [])
}

// --- Change History Viewer Component ---
const ChangeHistoryViewer = ({ projectId, isOpen, onClose }) => {
  const [changeLogs, setChangeLogs] = useState([])
  const [filteredLogs, setFilteredLogs] = useState([])
  const [filterAction, setFilterAction] = useState("all")

  useEffect(() => {
    if (isOpen) {
      const logs = getChangeLogs(projectId)
      setChangeLogs(logs)
      setFilteredLogs(logs)
    }
  }, [isOpen, projectId])

  useEffect(() => {
    if (filterAction === "all") {
      setFilteredLogs(changeLogs)
    } else {
      setFilteredLogs(changeLogs.filter(log => log.action === filterAction))
    }
  }, [filterAction, changeLogs])

  const formatTimestamp = (timestamp) => {
    return new Date(timestamp).toLocaleString()
  }

  const getActionColor = (action) => {
    switch (action) {
      case "node_created":
      case "shape_created":
      case "connection_created":
      case "test_generated":
      case "study_guide_generated":
      case "ai_autofill_completed":
      case "notes_developed":
      case "backend_sync_success":
      case "backend_load_success":
        return "text-green-600"
      case "node_updated":
      case "node_moved":
      case "node_positioned":
      case "node_resized":
      case "node_label_updated":
      case "shape_memory_saved":
      case "file_type_changed":
      case "project_saved":
        return "text-orange-600"
      case "node_deleted":
      case "connection_deleted":
      case "file_deleted":
      case "backend_sync_failed":
      case "backend_sync_error":
      case "backend_load_error":
        return "text-red-600"
      case "file_uploaded":
      case "file_imported":
      case "project_loaded":
      case "project_exported":
      case "ai_tool_executed":
      case "ai_arrange_completed":
        return "text-purple-600"
      case "node_selected":
        return "text-gray-600"
      default:
        return "text-gray-700"
    }
  }

  const getActionIcon = (action) => {
    switch (action) {
      case "node_created":
      case "shape_created":
        return "+"
      case "node_deleted":
      case "connection_deleted":
      case "file_deleted":
        return "×"
      case "node_moved":
      case "node_positioned":
        return "↔"
      case "connection_created":
        return "→"
      case "file_uploaded":
      case "file_imported":
        return "↑"
      case "project_saved":
        return "💾"
      case "project_exported":
        return "📤"
      case "ai_tool_executed":
      case "ai_autofill_completed":
      case "ai_arrange_completed":
        return "🤖"
      case "test_generated":
        return "📝"
      case "study_guide_generated":
        return "📚"
      case "notes_developed":
        return "📄"
      case "backend_sync_success":
      case "backend_load_success":
        return "☁️"
      case "backend_sync_failed":
      case "backend_sync_error":
      case "backend_load_error":
        return "⚠️"
      default:
        return "•"
    }
  }

  const uniqueActions = [...new Set(changeLogs.map(log => log.action))]

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center">
            <History className="h-5 w-5 mr-2" />
            Change History ({changeLogs.length} entries)
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          {/* Filter Controls */}
          <div className="flex items-center space-x-2">
            <Label htmlFor="action-filter" className="text-sm">Filter by action:</Label>
            <Select value={filterAction} onValueChange={setFilterAction}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Actions</SelectItem>
                {uniqueActions.map(action => (
                  <SelectItem key={action} value={action}>
                    {action.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="text-sm text-gray-500">
              Showing {filteredLogs.length} of {changeLogs.length} entries
            </div>
          </div>

          {/* Change Log List */}
          <div className="max-h-96 overflow-y-auto border border-gray-200 rounded-md">
            {filteredLogs.length > 0 ? (
              <div className="space-y-1 p-2">
                {filteredLogs.map((log) => (
                  <div key={log.id} className="flex items-start space-x-3 p-2 hover:bg-gray-50 rounded-md">
                    <div className="flex-shrink-0 w-6 h-6 flex items-center justify-center text-sm">
                      {getActionIcon(log.action)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-2">
                        <span className={`text-sm font-medium ${getActionColor(log.action)}`}>
                          {log.action.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                        </span>
                        <span className="text-xs text-gray-500">
                          {formatTimestamp(log.timestamp)}
                        </span>
                      </div>
                      <p className="text-sm text-gray-600 mt-1">{log.details}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-8 text-center text-gray-500">
                <History className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                <p>No change history available</p>
                <p className="text-sm">Actions will appear here as you work on your project</p>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

