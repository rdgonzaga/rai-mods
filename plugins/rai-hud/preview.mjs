// Preview the mascot in your terminal: node preview.mjs [full|mini]
import { pixels, asAnsi } from './hooks/sprite.js'

const size = process.argv[2] || 'full'
for (const s of ['IDLE', 'THINKING', 'SCANNING', 'EDITING', 'EXEC', 'NET', 'ALERT', 'DONE', 'STOPPED', 'LEVELUP', 'SLEEP', 'BOOT']) {
  console.log('== ' + s)
  console.log(asAnsi(pixels(s, s === 'BOOT' ? 6 : 3, { size })))
}
