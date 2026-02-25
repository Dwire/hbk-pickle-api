import pino from 'pino'
import { pinoHttp } from 'pino-http'

const loggerName = 'hbk-pickle-api'

export const logger = pino({
  name: loggerName,
  level: process.env.LOG_LEVEL ?? 'info'
})

export const httpLogger = pinoHttp({
  autoLogging: true
})
