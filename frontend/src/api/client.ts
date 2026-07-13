import axios from 'axios'
import { toast } from 'sonner'

export const api = axios.create({
  // @ts-ignore
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1',
  headers: {
    'Content-Type': 'application/json',
  },
})

// Optional: add interceptors for global error handling
api.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error('API Error:', error)
    
    // Network errors (offline / server unreachable) are silenced here because
    // the Dexie/IndexedDB fallback in each hook will handle them gracefully.
    // Only server-side errors (4xx/5xx with a response) show toasts.
    const isNetworkError = !error.response || error.code === 'ERR_NETWORK'

    if (!isNetworkError) {
      toast.error(`Erro ${error.response.status}`, { 
        description: error.response.data?.detail || 'Ocorreu um erro no servidor.' 
      })
    }

    return Promise.reject(error)
  }
)
