// Récupérer les éléments
const userName = document.getElementById('userName');
const userPhoto = document.getElementById('userPhoto');
const wordCount = document.getElementById('wordCount');
const hskStats = document.getElementById('hskStats');

// Charger les données utilisateur
async function loadUserData() {
  try {
    const resUser = await fetch('/api/user'); // doit renvoyer { name, photoUrl }
    const user = await resUser.json();

    userName.textContent = user.name;
    userPhoto.src = user.photoUrl || 'https://via.placeholder.com/120';
  } catch (err) {
    console.error('Erreur user:', err);
  }

  try {
    const resWords = await fetch('/api/user-words'); 
    const words = await resWords.json(); 
    wordCount.textContent = `Nombre de mots : ${words.length}`;

    // Stats HSK
    const stats = { HSK1:0, HSK2:0, HSK3:0, HSK4:0, HSK5:0, HSK6:0, Streets:0 };

    words.forEach(word => {
      if(word.hsk) {
        if(stats[`HSK${word.hsk}`] !== undefined) stats[`HSK${word.hsk}`]++;
        else stats.Streets++;
      } else {
        stats.Streets++;
      }
    });

    // Afficher stats
    hskStats.innerHTML = '';
    for(const level in stats) {
      const li = document.createElement('li');
      li.className = 'list-group-item d-flex justify-content-between align-items-center';
      li.textContent = level;
      const badge = document.createElement('span');
      badge.className = 'badge bg-primary rounded-pill';
      badge.textContent = stats[level];
      li.appendChild(badge);
      hskStats.appendChild(li);
    }

  } catch (err) {
    console.error('Erreur mots:', err);
  }
}

// Initialisation
document.addEventListener('DOMContentLoaded', loadUserData);
