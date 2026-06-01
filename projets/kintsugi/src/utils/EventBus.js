// EventBus.js — Bus d'événements global
// Référence : _specifications/technical-architecture.md §4
//
// Singleton partagé par tous les systèmes et scènes du jeu.
// Utilise Phaser.Events.EventEmitter natif.
//
// Événements émis dans le jeu :
//   'trick:attempt'   → { trickId, envId }
//   'trick:success'   → { trickId, envId, crackId }
//   'trick:fail'      → { trickId, envId }
//   'crack:grey'      → { crackId }
//   'crack:gold'      → { crackId }
//   'env:unlock'      → { envId }
//   'board:complete'  → {}
//
// Usage :
//   import EventBus from '../utils/EventBus.js';
//   EventBus.on('trick:success', ({ trickId }) => { ... }, this);
//   EventBus.emit('trick:success', { trickId: 'kickflip', envId: 'street' });
//
// IMPORTANT : Appeler EventBus.off(event, callback, context) dans shutdown()
//             de chaque scène/système pour éviter les fuites mémoire.

const EventBus = new Phaser.Events.EventEmitter();

export default EventBus;
