import './style.css'
import { createHoverController } from './hover-controller'
import { observeTwitchCards } from './twitch-card-observer'

function bootstrap() {
  if (window.top !== window.self || location.hostname !== 'www.twitch.tv') {
    return
  }

  const controller = createHoverController()
  const stopObserving = observeTwitchCards({
    onCardFound: (card) => controller.registerCard(card),
    onCardRemoved: (card) => controller.unregisterCard(card.anchor),
  })

  const cleanup = () => {
    stopObserving()
    controller.destroy()
  }

  window.addEventListener('pagehide', cleanup, { once: true })
}

bootstrap()
