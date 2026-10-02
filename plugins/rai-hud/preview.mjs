// Preview every mascot state in your terminal: node preview.mjs
import { pixels, asAnsi } from './hooks/sprite.js'
for (const s of ['IDLE', 'THINKING', 'SCANNING', 'EDITING', 'EXEC', 'ALERT', 'DONE', 'STOPPED', 'SLEEP']) {
  console.log('== ' + s)
  console.log(asAnsi(pixels(s, 1)))
}
