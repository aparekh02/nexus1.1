# Student Project Platform

A React-based platform for students to create, share, and collaborate on projects with their classmates.

## Features

- **User Authentication**: Sign up and login with Supabase
- **User Profiles**: Display user information and enrolled classes
- **Project Feed**: View all projects from all users (most recent first)
- **School Projects**: View projects specifically from your school
- **Create Projects**: Create new projects with title, description, subject, and access levels
- **Responsive Design**: Works on desktop and mobile devices

## Prerequisites

- Node.js (version 16 or higher)
- npm or pnpm
- A Supabase account and project

## Supabase Setup

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to Settings > API to get your project URL and anon key
3. Create the following tables in your Supabase database:

### Users Table
```sql
CREATE TABLE users (
  id UUID REFERENCES auth.users(id) PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  school TEXT NOT NULL,
  classes TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view all profiles" ON users FOR SELECT USING (true);
CREATE POLICY "Users can insert their own profile" ON users FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update their own profile" ON users FOR UPDATE USING (auth.uid() = id);
```

### Projects Table
```sql
CREATE TABLE projects (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  subject TEXT NOT NULL,
  access_level TEXT NOT NULL DEFAULT 'private',
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Anyone can view projects" ON projects FOR SELECT USING (true);
CREATE POLICY "Users can insert their own projects" ON projects FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own projects" ON projects FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own projects" ON projects FOR DELETE USING (auth.uid() = user_id);
```

## Installation

1. Extract the project files to your desired directory
2. Navigate to the project directory in your terminal
3. Install dependencies:
   ```bash
   npm install
   ```

## Environment Configuration

1. Create a `.env` file in the root directory
2. Add your Supabase credentials:
   ```
   VITE_SUPABASE_URL=your_supabase_project_url_here
   VITE_SUPABASE_ANON_KEY=your_supabase_anon_key_here
   ```

**Important**: Replace `your_supabase_project_url_here` and `your_supabase_anon_key_here` with your actual Supabase credentials.

## Running the Application

1. Start the development server:
   ```bash
   npm run dev
   ```

2. Open your browser and navigate to `http://localhost:5173`

## Usage

1. **Sign Up**: Create a new account with your name, email, school, and classes
2. **Login**: Sign in with your email and password
3. **View Projects**: Browse all projects in the main feed
4. **School Projects**: See projects from students at your school in the right sidebar
5. **Create Project**: Click "Create Project" to add a new project
6. **Logout**: Click the logout button to sign out

## Project Structure

```
src/
├── components/
│   ├── ui/                 # UI components (buttons, cards, etc.)
│   ├── AuthModal.jsx       # Login/signup modal
│   ├── CreateProject.jsx   # Create project page
│   ├── Homepage.jsx        # Main homepage layout
│   ├── Navbar.jsx          # Navigation bar
│   ├── ProjectFeed.jsx     # Main project feed
│   ├── SchoolProjects.jsx  # School-specific projects
│   └── UserProfile.jsx     # User profile sidebar
├── contexts/
│   └── AuthContext.jsx     # Authentication context
├── lib/
│   └── supabase.js         # Supabase client configuration
├── App.jsx                 # Main app component
└── main.jsx               # Entry point
```

## Technologies Used

- **React 18**: Frontend framework
- **Vite**: Build tool and dev server
- **Tailwind CSS**: Styling
- **shadcn/ui**: UI component library
- **Supabase**: Backend as a Service (authentication and database)
- **Lucide React**: Icons

## Troubleshooting

- **Authentication not working**: Check that your Supabase URL and anon key are correct in the `.env` file
- **Database errors**: Ensure you've created the required tables and policies in Supabase
- **Build errors**: Make sure all dependencies are installed with `npm install`

## Support

If you encounter any issues, please check:
1. Your Supabase credentials are correct
2. The database tables are created properly
3. All dependencies are installed
4. You're using a supported Node.js version (16+)

