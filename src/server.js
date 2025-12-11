const express = require('express')
const cors = require('cors')
const webpush = require('web-push')
const dotenv = require('dotenv')
const { v4: uuidv4 } = require('uuid')
const fs = require('fs')
const path = require('path')

dotenv.config()

const DATA_FILE = path.join(__dirname, '..', 'data.json')

const app = express()
app.use(cors({
  origin: ['https://robydoby.github.io/Push-test/', 'http://localhost:3000'],
  credentials: true
}));
app.use(express.json())

const subscriptions = []
let scheduled = []
const timers = new Map()

async function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const d = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'))
      scheduled = d.scheduled || []
    }
  } catch (e) {
    scheduled = []
    await saveData()
  }
}

async function saveData() {
  await fs.writeFileSync(DATA_FILE, JSON.stringify({ scheduled }, null, 2), 'utf-8')
}

function scheduleJob(item) {
  const delay = item.timestamp - Date.now()
  if (delay <= 0) {
    // immediate send
    sendItem(item).catch(console.error)
    return
  }
  const t = setTimeout(async () => {
    await sendItem(item)
  }, delay)
  timers.set(item.id, t)
}

function clearSendedSchedules() {
  scheduled = scheduled.filter((s) => s.status === 'scheduled')
}

async function sendItem(item) {
  // отправляем всем подпискам
  const payload = JSON.stringify({ title: 'Напоминание', body: item.text })

  for (const sub of subscriptions) {
    webpush
      .sendNotification(sub, payload)
      .then(() => console.log('send successfuly'))
      .catch((err) => {
        if (err.statusCode === 410 || err.statusCode === 404) {
          // Подписка недействительна — удаляем
          subscriptions.splice(i, 1)
          saveSubscriptions()
          console.log('Removed expired subscription', sub.endpoint)
        } else {
          console.error('Push failed:', err.statusCode, err.body)
        }
      })
  }
  item.status = 'sent'
  await saveData()
  // clear timer
  const t = timers.get(item.id)
  if (t) clearTimeout(t)
  timers.delete(item.id)
}

webpush.setVapidDetails(
  'mailto:test@example.com',
  process.env.PUBLIC_VAPID_KEY,
  process.env.PRIVATE_VAPID_KEY
)
// endpoints

app.post('/subscribe', (req, res) => {
  const sub = req.body
  // простой dedupe
  if (!subscriptions.find((s) => JSON.stringify(s) === JSON.stringify(sub))) {
    subscriptions.push(sub)
    saveSubscriptions()
  }
  res.json({ success: true })
})

app.post('/schedule', async (req, res) => {
  const { text, timestamp } = req.body
  if (!text || !timestamp) return res.status(400).json({ error: 'Bad request' })

  const item = {
    id: uuidv4(),
    text,
    timestamp,
    createdAt: Date.now(),
    status: 'scheduled'
  }

  scheduled.push(item)

  clearSendedSchedules()

  await saveData()

  scheduleJob(item)

  res.json({ success: true, item })
})

app.get('/scheduled', (req, res) => {
  res.json(scheduled)
})

app.delete('/scheduled/:id', async (req, res) => {
  const id = req.params.id
  const idx = scheduled.findIndex((s) => s.id === id)
  if (idx === -1) return res.status(404).json({ error: 'Not found' })

  // cancel timer
  const t = timers.get(id)
  if (t) {
    clearTimeout(t)
    timers.delete(id)
  }
  scheduled[idx].status = 'cancelled'
  await saveData()
  res.json({ success: true })
})

const SUB_FILE = path.join(__dirname, '../subscriptions.json')

function saveSubscriptions() {
  fs.writeFileSync(SUB_FILE, JSON.stringify(subscriptions, null, 2))
}

function loadSubscriptions() {
  if (fs.existsSync(SUB_FILE)) {
    const data = JSON.parse(fs.readFileSync(SUB_FILE, 'utf-8'))
    subscriptions.push(...data)
  }
}

// restore
;(async () => {
  await loadData()
  loadSubscriptions()
  // restore timers for unsent items
  for (const s of scheduled) {
    if (s.status === 'scheduled') scheduleJob(s)
  }
})()

const PORT = process.env.PORT ? Number(process.env.PORT) : 3001
app.listen(PORT, () => console.log(`Server on ${PORT}`))
