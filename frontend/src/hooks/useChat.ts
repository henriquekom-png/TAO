import { useMutation } from '@tanstack/react-query'
import { api } from '../api/client'
import { ChatResponse } from '../types'

export const useChatAsk = () => {
  return useMutation({
    mutationFn: async (data: any) => {
      const response = await api.post<ChatResponse>('/chat/ask', data)
      return response.data
    },
  })
}
