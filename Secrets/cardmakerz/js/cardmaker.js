const inputTitle = document.getElementById('input-title');
const inputSeries = document.getElementById('input-series');
const inputFont = document.getElementById('input-font');
const inputRarity = document.getElementById('input-rarity');
const inputImage = document.getElementById('input-image');
const inputUnderlay = document.getElementById('input-underlay');
const inputText = document.getElementById('input-text');

const cardElement = document.getElementById('card');
const cardTitle = document.getElementById('card-title');
const cardSeries = document.getElementById('card-series');
const cardRarity = document.getElementById('card-rarity');
const cardArt = document.getElementById('card-art');
const cardUnderlay = document.getElementById('card-underlay');
const cardText = document.getElementById('card-text');

function updateCard() {
  cardTitle.textContent = inputTitle.value || 'Nom de la carte';
  cardSeries.textContent = inputSeries.value || '';
  cardRarity.textContent = inputRarity.value;
  cardText.textContent = inputText.value || '';
  cardArt.style.backgroundImage = inputImage.value ? `url('${inputImage.value}')` : 'none';
  cardUnderlay.style.backgroundImage = inputUnderlay.value ? `url('${inputUnderlay.value}')` : 'none';

  // Gestion de la police
  const selectedFontOption = inputFont.options[inputFont.selectedIndex];
  cardElement.style.setProperty('--card-font', inputFont.value);

  // Gestion des classes (Rareté + Ajustements Typo)
  const selectedRarityOption = inputRarity.options[inputRarity.selectedIndex];
  const rarityClass = selectedRarityOption.getAttribute('data-class');
  const fontClass = selectedFontOption.getAttribute('data-class');
  
  cardElement.className = `card-preview ${rarityClass} ${fontClass}`;
}

inputTitle.addEventListener('input', updateCard);
inputSeries.addEventListener('input', updateCard);
inputFont.addEventListener('change', updateCard);
inputRarity.addEventListener('change', updateCard);
inputImage.addEventListener('input', updateCard);
inputUnderlay.addEventListener('input', updateCard);
inputText.addEventListener('input', updateCard);

updateCard();

document.getElementById('download-btn').addEventListener('click', () => {
  html2canvas(cardElement, {
    useCORS: true,
    scale: 2
  }).then(canvas => {
    const link = document.createElement('a');
    link.download = `${inputTitle.value || 'carte'}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  });
});

