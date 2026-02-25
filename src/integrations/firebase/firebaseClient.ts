import admin from 'firebase-admin'

import { config } from '../../shared/config.js'

const firebaseApp = admin.initializeApp({
  credential: admin.credential.cert({
    projectId: config.firebase.projectId,
    clientEmail: config.firebase.clientEmail,
    privateKey: config.firebase.privateKey
  })
})

export const firebaseMessaging = firebaseApp.messaging()
