import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Home } from './pages/Home';
import { Auth } from './pages/Auth';
import { useState, useEffect } from 'react';

const queryClient = new QueryClient();

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(!!localStorage.getItem('token'));

  useEffect(() => {
    const handleAuthError = () => setIsAuthenticated(false);
    window.addEventListener('auth-error', handleAuthError);
    return () => window.removeEventListener('auth-error', handleAuthError);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <Router>
        <Routes>
          <Route path="/auth" element={
            isAuthenticated ? <Navigate to="/" replace /> : <Auth onLogin={() => setIsAuthenticated(true)} />
          } />
          <Route path="/" element={
            isAuthenticated ? <Home /> : <Navigate to="/auth" replace />
          } />
        </Routes>
      </Router>
    </QueryClientProvider>
  );
}

export default App;
