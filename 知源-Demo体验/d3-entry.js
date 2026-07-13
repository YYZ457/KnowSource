import { select } from 'd3-selection'
import { drag } from 'd3-drag'
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
} from 'd3-force'
import { zoom, zoomIdentity } from 'd3-zoom'
import { color } from 'd3-color'
import 'd3-transition'

globalThis.d3 = {
  color,
  drag,
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  select,
  zoom,
  zoomIdentity,
}
