import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { z } from 'zod'
import type { Db } from '../db/client'
import { householdSettings } from '../db/schema'

// Household adult PIN: stored only as `scrypt$<salt hex>$<hash hex>` (Node defaults N=16384, r=8, p=1).

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>

export const Pin = z.string().regex(/^\d{4,8}$/, 'PIN must be 4–8 digits')

export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = await scryptAsync(pin, salt, 32)
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const [alg, salt, hash] = stored.split('$')
  if (alg !== 'scrypt' || !salt || !hash) return false
  const expected = Buffer.from(hash, 'hex')
  const actual = await scryptAsync(pin, Buffer.from(salt, 'hex'), expected.length)
  return timingSafeEqual(actual, expected)
}

export async function getPinHash(db: Db): Promise<string | null> {
  const [row] = await db.select().from(householdSettings)
  return row?.adultPinHash ?? null
}

/** Set (hash) or clear (null) the household PIN. */
export async function storePin(db: Db, pin: string | null): Promise<void> {
  const adultPinHash = pin === null ? null : await hashPin(pin)
  await db
    .insert(householdSettings)
    .values({ adultPinHash })
    .onConflictDoUpdate({ target: householdSettings.id, set: { adultPinHash, updatedAt: new Date() } })
}
