import type { Key } from 'chessground/types'

import { Board } from '../../../components/Board'

const EMPTY_DESTS = new Map<Key, Key[]>()

export function RepertoirePreviewBoard({
  fen,
  orientation,
  sizeClassName,
}: {
  fen: string
  orientation: 'white' | 'black'
  sizeClassName: string
}) {
  return (
    <div className={['repertoire-preview pointer-events-none overflow-hidden rounded-md', sizeClassName].join(' ')}>
      <Board
        fen={fen}
        dests={EMPTY_DESTS}
        turnColor="white"
        orientation={orientation}
        showCoordinates={false}
        showDests={false}
        touchMoveMode
      />
    </div>
  )
}
