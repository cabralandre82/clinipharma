import '@testing-library/jest-dom'
import { vi } from 'vitest'

// Mock firebase-admin to avoid credential initialization in unit tests
vi.mock('firebase-admin', () => ({
  default: {
    apps: [],
    initializeApp: vi.fn().mockReturnValue({ name: 'mock-app' }),
    credential: {
      cert: vi.fn().mockReturnValue({}),
    },
    messaging: vi.fn().mockReturnValue({
      sendEach: vi.fn().mockResolvedValue({ responses: [] }),
    }),
  },
}))

// Mock firebase (client SDK) to avoid browser API issues
vi.mock('firebase/app', () => ({
  initializeApp: vi.fn(),
  getApps: vi.fn().mockReturnValue([]),
}))
vi.mock('firebase/messaging', () => ({
  getMessaging: vi.fn(),
  getToken: vi.fn(),
  onMessage: vi.fn().mockReturnValue(() => {}),
}))

// Mock twilio
vi.mock('twilio', () => ({
  default: vi.fn().mockReturnValue({
    messages: { create: vi.fn().mockResolvedValue({ sid: 'test-sid' }) },
  }),
}))
