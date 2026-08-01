import './style.css'
import { createHoverController } from './hover-controller'
import { observeTwitchCards } from './twitch-card-observer'
import { observeDirectoryGrid } from './directory-grid-declutter'

function bootstrap() {
  if (window.top !== window.self || location.hostname !== 'www.twitch.tv') {
    return
  }

  const controller = createHoverController()
  const stopObserving = observeTwitchCards({
    onCardFound: (card) => controller.registerCard(card),
    onCardRemoved: (card) => controller.unregisterCard(card.anchor),
  })
  const stopDecluttering = observeDirectoryGrid()

  const cleanup = () => {
    stopObserving()
    stopDecluttering()
    controller.destroy()
  }

  window.addEventListener('pagehide', cleanup, { once: true })
}

bootstrap()
