let words=[], idx=0;
const container=document.getElementById('card-container');
const prevBtn=document.getElementById('prevBtn');
const nextBtn=document.getElementById('nextBtn');
const counter=document.getElementById('counter');

// modal
const editModal=document.getElementById('editModal');
const editForm=document.getElementById('editForm');
const cancelEdit=document.getElementById('cancelEdit');
const editId=document.getElementById('editId');
const editChinese=document.getElementById('editChinese');
const editPinyin=document.getElementById('editPinyin');
const editEnglish=document.getElementById('editEnglish');
const editDescription=document.getElementById('editDescription');

async function loadWords(){
  const res=await fetch('/liste'); words=await res.json();
  if(!words.length){container.innerHTML='<p>No words yet.</p>'; return;}
  idx=0; showCard();
}

function updateCounter(){counter.textContent=`${idx+1} / ${words.length}`;}

function createCardElement(word) {
  const card = document.createElement('div');
  card.style.width = '18rem';
  card.style.zIndex = 1;

card.innerHTML = `
  <div class="card bg-dark text-center text-white mt-3 p-4 pb-0 card-body d-flex flex-column justify-content-between" style="height:300px;">
    <div>
      <h2 class="card-title display-5" style="font-size:60px;">${word.chinese}</h2>
      <p class="card-text">Pinyin : ${word.pinyin || ''}</p>
      <p class="card-text">English : ${word.english || ''}</p>
      <p class="card-text" style="color: rgba(255,255,255,0.6);">${word.description || ''}</p>
    </div>
    <a href="#" class="btn btn-link text-white edit-btn">✏️ Edit</a>
  </div>
`;

  // rattache l'événement au bouton edit
  card.querySelector('.edit-btn').onclick = () => openEdit(word);

  return card;
}

function showCard() {
  if (!words.length) return;

  const word = words[idx];
  if (!word) return;

  // Supprime l'ancienne carte
  container.innerHTML = '';

  // Crée et ajoute la nouvelle carte
  const newCard = createCardElement(word);
  container.appendChild(newCard);

  updateCounter();
}



// navigation
prevBtn.onclick = ()=>{ idx=(idx-1+words.length)%words.length; showCard('left'); };
nextBtn.onclick = ()=>{ idx=(idx+1)%words.length; showCard('right'); };
window.addEventListener('keydown',e=>{
  if(e.key==='ArrowLeft') prevBtn.click();
  else if(e.key==='ArrowRight') nextBtn.click();
});

// modal Bootstrap
function openEdit(word) {
  // Remplir les champs
  editId.value = word.id;
  editChinese.value = word.chinese;
  editPinyin.value = word.pinyin || '';
  editEnglish.value = word.english || '';
  editDescription.value = word.description || '';

  // Afficher la modale avec Bootstrap
  const modal = new bootstrap.Modal(document.getElementById('editModal'));
  modal.show();
}

// Le bouton Cancel est maintenant géré par data-bs-dismiss dans le HTML, pas besoin de JS
// editForm submit
editForm.onsubmit = async (e) => {
  e.preventDefault();
  const payload = {
    chinese: editChinese.value,
    pinyin: editPinyin.value,
    english: editEnglish.value,
    description: editDescription.value
  };

  try {
    await fetch(`/update/${editId.value}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    words[idx] = { ...words[idx], ...payload };
    showCard(); // refresh
  } catch (err) {
    alert("Update failed");
  }

  // Fermer la modale via Bootstrap
  const modalEl = document.getElementById('editModal');
  const bsModal = bootstrap.Modal.getInstance(modalEl);
  if (bsModal) bsModal.hide();
};
loadWords();