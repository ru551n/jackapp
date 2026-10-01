import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterEach, beforeEach } from 'vitest'

beforeEach(() => localStorage.clear())
afterEach(cleanup)

// findBy*/waitFor default to 1 s, too short when the whole suite runs in parallel on a busy machine.
configure({ asyncUtilTimeout: 5000 })
