// Every retained node must finish visible, including nodes whose enter or exit
// fade was interrupted by a fast redraw or expand/collapse operation.
export function restoreNodeVisibility(selection, duration = 350) {
  return selection.transition().duration(duration).attr('opacity', 1)
}
