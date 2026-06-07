/**
 * Module d'affichage de la navigation commune
 */

const Nav = (() => {
    const menuItems = [
        { label: 'Accueil', href: 'index.html', icon: '🏠' },
        { label: 'Champions', href: 'champions.html', icon: '🏆' },
        { label: 'Challengers', href: 'users.html', icon: '⚔️' }
    ];

    /**
     * Construit et insère la barre de navigation dans le DOM
     * Met en évidence la page active selon l'URL courante
     */
    function render() {
        const currentPage = window.location.pathname.split('/').pop() || 'index.html';
        
        const nav = document.createElement('nav');
        nav.className = 'main-nav';
        
        const container = document.createElement('div');
        container.className = 'nav-container';

        const logo = document.createElement('a');
        logo.className = 'nav-logo';
        logo.href = 'index.html';
        logo.innerHTML = '<span class="logo-icon">⚡</span> PokeLeague';
        container.appendChild(logo);

        const ul = document.createElement('ul');
        ul.className = 'nav-menu';

        menuItems.forEach(item => {
            const li = document.createElement('li');
            const a = document.createElement('a');
            a.href = item.href;
            a.innerHTML = `${item.icon} ${item.label}`;
            a.className = 'nav-link';
            
            // Mettre en évidence la page active
            if (currentPage === item.href) {
                a.classList.add('active');
            }
            
            li.appendChild(a);
            ul.appendChild(li);
        });

        container.appendChild(ul);
        nav.appendChild(container);
        
        // Insérer la navigation en premier dans le body
        document.body.insertBefore(nav, document.body.firstChild);
    }

    return { render };
})();

// La config est chargée de manière synchrone par config.js
// Auto-rendre la navigation au chargement du DOM
document.addEventListener('DOMContentLoaded', () => Nav.render());
