import assert from 'node:assert/strict'
import test from 'node:test'

import type { AppContext } from '../context.js'
import {
  hashPushTokenForLogs,
  registerDeviceResolver
} from './registerDeviceResolver.js'

test('registerDeviceResolver logs hashed context without raw token on success', async () => {
  const infoLogs: Array<{ payload: Record<string, unknown>; message: string }> =
    []
  let upsertPayload: Record<string, unknown> | null = null
  const rawToken = 'raw-push-token'

  const context = buildContext({
    logger: {
      info(payload, message) {
        infoLogs.push({ payload, message })
      },
      error() {
        assert.fail('did not expect error log')
      }
    },
    prisma: {
      userDevice: {
        async findUnique() {
          return null
        },
        async upsert(payload) {
          upsertPayload = payload as Record<string, unknown>
          return {
            id: 'device-1',
            userId: 'user-1',
            token: rawToken,
            platform: 'ios'
          }
        }
      }
    }
  })

  const result = await registerDeviceResolver(
    null,
    { token: rawToken, platform: 'ios' },
    context
  )

  assert.equal(result, true)
  assert.ok(upsertPayload)
  assert.equal(infoLogs.length, 1)
  assert.equal(infoLogs[0]?.message, 'Registered device token')
  assert.deepEqual(infoLogs[0]?.payload, {
    userId: 'user-1',
    platform: 'ios',
    tokenHashPrefix: hashPushTokenForLogs(rawToken),
    outcome: 'created'
  })
  assert.equal(
    JSON.stringify(infoLogs[0]?.payload).includes(rawToken),
    false,
    'success log should not include the raw token'
  )
})

test('registerDeviceResolver logs hashed context before rethrowing errors', async () => {
  const errorLogs: Array<{
    payload: Record<string, unknown>
    message: string
  }> = []
  const rawToken = 'raw-push-token'
  const expectedError = new Error('db failed')

  const context = buildContext({
    logger: {
      info() {
        assert.fail('did not expect info log')
      },
      error(payload, message) {
        errorLogs.push({ payload, message })
      }
    },
    prisma: {
      userDevice: {
        async findUnique() {
          return { userId: 'user-9' }
        },
        async upsert() {
          throw expectedError
        }
      }
    }
  })

  await assert.rejects(
    () =>
      registerDeviceResolver(
        null,
        { token: rawToken, platform: 'ios' },
        context
      ),
    expectedError
  )

  assert.equal(errorLogs.length, 1)
  assert.equal(errorLogs[0]?.message, 'Register device failed')
  assert.equal(errorLogs[0]?.payload.userId, 'user-1')
  assert.equal(errorLogs[0]?.payload.platform, 'ios')
  assert.equal(
    errorLogs[0]?.payload.tokenHashPrefix,
    hashPushTokenForLogs(rawToken)
  )
  assert.equal(
    JSON.stringify(errorLogs[0]?.payload).includes(rawToken),
    false,
    'error log should not include the raw token'
  )
})

type LoggerShape = {
  info: (payload: Record<string, unknown>, message: string) => void
  error: (payload: Record<string, unknown>, message: string) => void
}

type PrismaShape = {
  userDevice: {
    findUnique: (args: unknown) => Promise<{ userId: string } | null>
    upsert: (args: unknown) => Promise<unknown>
  }
}

const buildContext = ({
  logger,
  prisma
}: {
  logger: LoggerShape
  prisma: PrismaShape
}): AppContext => {
  return {
    config: {
      auth: { jwtSecret: 'unused' }
    },
    logger,
    prisma,
    request: {
      requestId: 'request-1',
      authToken: null,
      userId: 'user-1',
      authzCache: {
        hasVerifiedUser: false,
        orgAdminByOrgId: new Map<string, boolean>(),
        orgIdByLeagueId: new Map<string, string>(),
        leagueIdBySessionId: new Map<string, string>(),
        leagueIdByOccurrenceId: new Map<string, string>(),
        leagueIdBySlotAssignmentId: new Map<string, string>(),
        leagueAccessByLeagueId: new Map<string, boolean>(),
        userRoleByOrgAndUser: new Map<string, 'PLAYER' | 'ADMIN' | 'OWNER'>()
      }
    }
  } as AppContext
}
