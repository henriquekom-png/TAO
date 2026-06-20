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
    
    // Tratamento global de erro com feedback visual
    if (!error.response) {
      toast.error('Erro de Conexão', { 
        description: 'Não foi possível conectar ao servidor. Verifique sua internet ou aguarde o servidor acordar.' 
      })
    } else {
      toast.error(`Erro ${error.response.status}`, { 
        description: error.response.data?.detail || 'Ocorreu um erro no servidor.' 
      })
    }

    return Promise.reject(error)
  }
)
