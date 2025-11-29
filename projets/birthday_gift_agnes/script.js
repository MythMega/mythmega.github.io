// script.js - single JS for both pages

(function () {
  // Utility: shuffle array in place
  function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  // QUIZ logic (index.html)
  if (document.getElementById('quiz')) {
    const quizEl = document.getElementById('quiz');
    const questionArea = document.getElementById('question-area');
    const progressEl = document.getElementById('progress');

    const questions = [
      {
        q: "What age are Pikachu and Noctali ?",
        answers: [
          { text: "6", correct: true },
          { text: "4", correct: false },
          { text: "8", correct: false },
          { text: "28", correct: false }
        ]
      },
      {
        q: "What's My favorite Video Game ?",
        answers: [
          { text: "Minecraft", correct: true },
          { text: "Pokémon Scarlet/Violet", correct: false },
          { text: "Mario 64", correct: false },
          { text: "Fortnite", correct: false }
        ]
      },
      {
        q: "What's our relationship anniversary ?",
        answers: [
          { text: "September 7, 2022", correct: true },
          { text: "July 31, 2022", correct: false },
          { text: "September 22, 2023", correct: false },
          { text: "October 7, 2023", correct: false }
        ]
      }
    ];

    let current = 0;

    function renderQuestion() {
      const item = questions[current];
      questionArea.innerHTML = '';

      const qEl = document.createElement('div');
      qEl.className = 'question';
      qEl.textContent = item.q;
      questionArea.appendChild(qEl);

      // clone and shuffle answers so original order is preserved
      const answers = shuffle(item.answers.slice());
      const answersWrap = document.createElement('div');
      answersWrap.className = 'answers';

      answers.forEach(ans => {
        const btn = document.createElement('button');
        btn.className = 'answer-btn';
        btn.type = 'button';
        btn.textContent = ans.text;
        btn.addEventListener('click', () => handleAnswer(ans.correct));
        answersWrap.appendChild(btn);
      });

      questionArea.appendChild(answersWrap);
      progressEl.textContent = `Question ${current + 1} of ${questions.length}`;
    }

    function handleAnswer(isCorrect) {
      if (!isCorrect) {
        // wrong answer: popup and reset to question 1
        alert('loooooooser');
        current = 0;
        renderQuestion();
        return;
      }

      // correct: next question or finish
      current++;
      if (current >= questions.length) {
        // success -> go to gift page
        // small delay for UX
        setTimeout(() => {
          window.location.href = 'gift.html';
        }, 250);
      } else {
        renderQuestion();
      }
    }

    // initial render
    renderQuestion();
  }

  // GIFT page logic (gift.html)
  if (document.getElementById('revealBtn')) {
    const revealBtn = document.getElementById('revealBtn');
    const imageWrapper = document.getElementById('imageWrapper');
    const lolContainer = document.getElementById('lolContainer');

    let revealed = false;

    revealBtn.addEventListener('click', () => {
      if (revealed) return;
      revealed = true;

      // show image
      imageWrapper.style.display = 'block';
      imageWrapper.setAttribute('aria-hidden', 'false');

      // reveal button disabled
      revealBtn.disabled = true;
      revealBtn.textContent = 'Revealed';

      // create up to 25 "lol" elements at random positions
      const max = 25;
      const count = max; // fixed 25 to match request (max 25)
      const containerRect = lolContainer.getBoundingClientRect();

      // ensure container has some height; if not, use viewport
      const width = containerRect.width || window.innerWidth;
      const height = containerRect.height || window.innerHeight * 0.5;

      for (let i = 0; i < count; i++) {
        const span = document.createElement('span');
        span.className = 'lol';
        span.textContent = 'lol';

        // random font size and opacity for variety
        const size = 12 + Math.floor(Math.random() * 18); // 12-30px
        span.style.fontSize = size + 'px';
        span.style.opacity = (0.5 + Math.random() * 0.9).toString();

        // random color tint subtle
        const hue = Math.floor(Math.random() * 360);
        span.style.color = `hsla(${hue}, 80%, 92%, ${0.9 - Math.random() * 0.4})`;

        // random position inside container
        const x = Math.random() * 100; // percent
        const y = Math.random() * 100; // percent
        span.style.left = x + '%';
        span.style.top = y + '%';

        // small random rotation
        const rot = -20 + Math.random() * 40;
        span.style.transform = `translate(-50%,-50%) rotate(${rot}deg)`;

        lolContainer.appendChild(span);
      }

      // make lolContainer visible for mobile layout
      lolContainer.setAttribute('aria-hidden', 'false');
    });
  }
})();
