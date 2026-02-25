import cors from 'cors'
import express from 'express'
import { ApolloServer } from 'apollo-server-express'

import { config } from '../shared/config.js'
import { httpLogger, logger } from '../shared/logger.js'

import { buildContext } from './context.js'
import { schema } from './graphql/schema.js'

const app = express()

app.use(httpLogger)
app.use(cors())
app.use(express.json())

const apolloServer = new ApolloServer({
  schema,
  context: ({ req }: { req: express.Request }) => buildContext(req)
})

const startServer = async (): Promise<void> => {
  await apolloServer.start()
  apolloServer.applyMiddleware({ app, path: '/graphql' })

  app.listen(config.port, () => {
    logger.info({ port: config.port }, 'GraphQL server listening')
  })
}

startServer().catch((error) => {
  logger.error({ error }, 'Failed to start server')
  process.exit(1)
})
