// Development only: the app's own module instances on window.__dev, for driving and checking it from the console
// (a fresh import() of a module that hot-reloaded would load a second copy with its own state).

import * as actions from './ui/actions'
import * as canvas from './ui/CanvasView'
import * as commands from './ui/commands'
import * as overlay from './ui/overlayState'
import * as store from './ui/store'
import * as move from './ui/tools/move'
import * as save from './io/save'
import * as comp from './io/comp'

Object.assign(window, { __dev: { actions, canvas, commands, overlay, store, move, save, comp } })
