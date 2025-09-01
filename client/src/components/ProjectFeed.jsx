import { useState, useEffect, useCallback, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Badge } from './ui/badge'
import { Clock, User, School } from 'lucide-react'
import { supabase } from '../lib/supabase'
import axios from 'axios'
import { useAuth } from './AuthContext'

const PROJECTS_PER_PAGE = 10;

// Set the base URL for your Flask backend
const API_BASE_URL = 'https://nexus-backend-f2td.onrender.com'
axios.defaults.baseURL = API_BASE_URL

export default function ProjectFeed() {
  const { user } = useAuth()
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [projectName, setProjectName] = useState('')
  const [description, setDescription] = useState('')
  const [subject, setSubject] = useState('')
  const [posting, setPosting] = useState(false)
  const [showComments, setShowComments] = useState(null)
  const [newCommentText, setNewCommentText] = useState("")
  const [comments, setComments] = useState([]) 
  const observer = useRef()

  const fetchProjects = useCallback(async (currentPage) => {
    if (currentPage === 0) {
      setLoading(true)
    } else {
      setLoadingMore(true)
    }
    
    try {
      const from = currentPage * PROJECTS_PER_PAGE;
      const to = from + PROJECTS_PER_PAGE - 1;

      const { data, error } = await supabase
        .from('projects')
        .select(`
          *,
          users (
            name,
            school
          )
        `)
        .order('created_at', { ascending: false })
        .range(from, to)

      if (error) {
        console.error('Error fetching projects:', error)
        setHasMore(false)
      } else {
        setProjects(prev => [...prev, ...(data || [])])
        setHasMore(data.length === PROJECTS_PER_PAGE)
      }
    } catch (error) {
      console.error('Error fetching projects:', error)
      setHasMore(false)
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [])

  useEffect(() => {
    fetchProjects(0)
  }, [fetchProjects])

  const lastProjectElementRef = useCallback(node => {
    if (loadingMore || !hasMore) return
    if (observer.current) observer.current.disconnect()
    observer.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore) {
        setPage(prevPage => {
          const nextPage = prevPage + 1
          fetchProjects(nextPage)
          return nextPage
        })
      }
    })
    if (node) observer.current.observe(node)
  }, [loadingMore, hasMore, fetchProjects])

  const formatDate = (dateString) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })
  }

  const handleLike = async (postId) => {
    if (!user) {
      alert("Please log in to like posts.");
      return;
    }
    try {
      const token = localStorage.getItem('jwt_token')
      const response = await axios.post(`${API_BASE_URL}/api/posts/${postId}/like`, {
        user_id: user.email // Assuming user.email is the user_id for likes
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.data.success) {
        const newLikeCount = response.data.like_count;
        setProjects(prevProjects =>
          prevProjects.map(project =>
            project.id === postId ? { ...project, like_count: newLikeCount } : project
          )
        );
      } else {
        alert(response.data.message || 'Failed to like post.');
      }
    } catch (error) {
      console.error('Error liking post:', error);
      alert('Error liking post. Please try again.');
    }
  };

  const handleComment = async (postId) => {
    if (showComments === postId) {
      setShowComments(null);
      setComments([]);
    } else {
      setShowComments(postId);
      fetchComments(postId);
    }
  };

  const fetchComments = async (postId) => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/posts/${postId}/comments`);
      if (response.data.success) {
        setComments(response.data.comments);
      } else {
        console.error('Failed to fetch comments:', response.data.error);
        setComments([]);
      }
    } catch (error) {
      console.error('Error fetching comments:', error);
      setComments([]);
    }
  };

  const handleAddComment = async (postId) => {
    if (!user) {
      alert("Please log in to comment.");
      return;
    }
    if (!newCommentText.trim()) {
      alert("Comment cannot be empty.");
      return;
    }

    try {
      const token = localStorage.getItem('jwt_token')
      const response = await axios.post(`${API_BASE_URL}/api/posts/${postId}/comments`, {
        comment_text: newCommentText.trim()
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.data.success) {
        setNewCommentText("");
        fetchComments(postId); // Refresh comments after adding
      } else {
        alert(response.data.error || 'Failed to add comment.');
      }
    } catch (error) {
      console.error('Error adding comment:', error);
      alert('Error adding comment. Please try again.');
    }
  };

  const handlePost = async () => {
    if (!projectName.trim() || !description.trim() || !subject.trim()) {
      alert('Please fill in all fields')
      return
    }
    
    setPosting(true)
    try {
      // Use the same exact structure as CreateProject.jsx
      const token = localStorage.getItem('jwt_token')
      const response = await axios.post('/api/projects', {
        title: projectName.trim(),
        description: description.trim(),
        subject: subject,
        access_level: 'private',
        user_id: user.id || user.user_id || user.email,
        created_at: new Date().toISOString()
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      })
      
      if (response.data.success) {
        setProjectName('')
        setDescription('')
        setSubject('')
        // Refresh the projects list to show the new post
        setProjects([])
        setPage(0)
        setHasMore(true)
        fetchProjects(0)
      } else {
        console.error('Failed to create post')
        alert('Failed to create post. Please try again.')
      }
    } catch (error) {
      console.error('Error creating post:', error)
      
      // Handle different types of errors - same as CreateProject.jsx
      if (error.response) {
        const errorMessage = error.response.data?.error || 
                            error.response.data?.message || 
                            `Server error: ${error.response.status}`
        alert(errorMessage)
      } else if (error.request) {
        alert('Unable to connect to server. Please check if the backend is running.')
      } else {
        alert('Failed to create project. Please try again.')
      }
    } finally {
      setPosting(false)
    }
  }

  if (loading && page === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-gray-500">Loading projects...</div>
      </div>
    )
  }

  return (
    <div className="w-full max-w-4xl mx-auto px-4">
      {/* Feed Heading */}
      <h2 className="text-2xl font-bold text-gray-800 mb-4">My Feed</h2>
      {/* Post Creation UI */}
      <div className="bg-white border rounded-lg p-4 mb-6 shadow-sm">
        <div className="flex items-start space-x-3">
          <div className="w-10 h-10 bg-gray-300 rounded-full flex items-center justify-center">
            <User className="h-5 w-5 text-gray-600" />
          </div>
          <div className="flex-1 space-y-3">
            <input
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="Project title"
              className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description"
              className="w-full p-3 border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              rows="3"
            />
            <select
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">Select subject</option>
              <option value="Math">Math</option>
              <option value="Science">Science</option>
              <option value="History">History</option>
              <option value="Art">Art</option>
              <option value="Computer Science">Computer Science</option>
              <option value="English">English</option>
            </select>
            <div className="flex justify-end">
              <button
                onClick={handlePost}
                disabled={!projectName.trim() || !description.trim() || !subject.trim() || posting}
                className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
              >
                {posting ? 'Posting...' : 'Post'}
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className="space-y-4">
        {projects.length === 0 && !loading ? (
          <div className="text-center py-8 text-gray-500 text-sm">
            No projects yet. Be the first to create one!
          </div>
        ) : (
          projects.map((project, index) => {
            const isLastElement = projects.length === index + 1;
            return (
              <div 
                ref={isLastElement ? lastProjectElementRef : null}
                key={project.id} 
                className="border rounded-lg p-3 hover:bg-gray-50 transition-colors bg-white shadow-sm"
              >
                <div>
                  <div className="flex items-start justify-between mb-2">
                    <h3 className="font-semibold text-base text-gray-900">{project.title}</h3>
                    <Badge variant="secondary" className="text-xs flex-shrink-0">
                      {project.subject}
                    </Badge>
                  </div>
                  <p className="text-sm text-gray-700 mb-3">{project.content}</p>
                </div>
                
                <div className="flex items-center justify-between text-xs text-gray-500 pt-2 border-t">
                  <div className="flex items-center space-x-3">
                    <div className="flex items-center space-x-1">
                      <User className="h-3 w-3" />
                      <span>{project.users?.name || 'Anonymous'}</span>
                    </div>
                    <div className="flex items-center space-x-1">
                      <School className="h-3 w-3" />
                      <span>{project.users?.school || 'N/A'}</span>
                    </div>
                  </div>
                  <div className="flex items-center space-x-1">
                    <Clock className="h-3 w-3" />
                    <span>{formatDate(project.created_at)}</span>
                  </div>
                </div>
                <div className="flex items-center justify-end space-x-4 mt-3">
                  <button onClick={() => handleLike(project.id)} className="flex items-center space-x-1 text-xs text-gray-500 hover:text-orange-600">
                    <span className="font-medium">{Math.floor(Math.random() * (100 - 15 + 1)) + 15}</span>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>
                    <span>Like</span>
                  </button>
                  <button onClick={() => handleComment(project.id)} className="flex items-center space-x-1 text-xs text-gray-500 hover:text-orange-600">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 16h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
                    <span>Comment</span>
                  </button>
                </div>
                {showComments === project.id && (
                  <div className="mt-4 border-t pt-4">
                    <h4 className="font-semibold mb-2">Comments</h4>
                    <div className="space-y-3">
                      {comments.length === 0 ? (
                        <p className="text-sm text-gray-500">No comments yet. Be the first to comment!</p>
                      ) : (
                        comments.map((comment) => (
                          <div key={comment.id} className="bg-gray-100 p-3 rounded-lg">
                            <p className="text-xs font-semibold text-gray-800">{comment.users?.name || 'Anonymous'}</p>
                            <p className="text-sm text-gray-700">{comment.comment_text}</p>
                            <p className="text-xs text-gray-500 text-right">{formatDate(comment.created_at)}</p>
                          </div>
                        ))
                      )}
                    </div>
                    <div className="mt-4 flex space-x-2">
                      <input
                        type="text"
                        value={newCommentText}
                        onChange={(e) => setNewCommentText(e.target.value)}
                        placeholder="Add a comment..."
                        className="flex-1 p-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                      />
                      <button
                        onClick={() => handleAddComment(project.id)}
                        className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors text-sm"
                      >
                        Post
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })
        )}
        {loadingMore && <div className="text-center py-4 text-gray-500 text-sm">Loading more projects...</div>}
        {!hasMore && projects.length > 0 && <div className="text-center py-4 text-gray-500 text-sm">You've reached the end!</div>}
      </div>
    </div>
  )
}

