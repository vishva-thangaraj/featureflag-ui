import createClient, { type Middleware } from 'openapi-fetch'
import type { paths } from './schema'
import { getAccessToken, refresh } from '@/auth/session'


export const api = createClient<paths>({ baseUrl: window.location.origin })

const retryable = new Map<string, Request>()

const bearerAuth: Middleware = {
  onRequest({ request, id }) {
    const token = getAccessToken()
    if (token) {
      request.headers.set('Authorization', `Bearer ${token}`)
      retryable.set(id, request.clone())
    }
    return request
  },

  async onResponse({ response, id }) {
    const original = retryable.get(id)
    retryable.delete(id)
    if (response.status !== 401 || !original) {
      return response
    }
    const token = await refresh()
    if (!token) {
      return response
    }
    original.headers.set('Authorization', `Bearer ${token}`)
    return fetch(original)
  },

  onError({ id }) {
    retryable.delete(id)
  },
}

api.use(bearerAuth)
