let words=[], idx=0;
let touchStartY = 0;
const cardContainer=document.getElementById('card-container');
const prevBtn=document.getElementById('prevBtn');
const nextBtn=document.getElementById('nextBtn');
const listContainer=document.getElementById('list-container');
const listBody=document.getElementById('listBody');

// modal
const editModal=document.getElementById('editModal');
const editForm=document.getElementById('editForm');
const editId=document.getElementById('editId');
const editChinese=document.getElementById('editChinese');
const editPinyin=document.getElementById('editPinyin');
const editEnglish=document.getElementById('editEnglish');
const editDescription=document.getElementById('editDescription');

// Load words
async function loadWords(){
  const res=await fetch('/mes-mots'); 
  words=await res.json();
  if(!words.length){
    cardContainer.innerHTML='<p>No words yet.</p>';
    return;
  }
  idx=0; 
  showCard();
  showList();
}

// scroll control
cardContainer.addEventListener('wheel', (e) => {
  const canScroll = cardContainer.scrollHeight > cardContainer.clientHeight;
  
  // Si la carte tient dans le conteneur, on autorise le toggle
  if(!canScroll && Math.abs(e.deltaY) > 30){
    toggleView('list');
  }
});

// Card creation
function createCardElement(word) {
  const card = document.createElement('div');
  card.style.width = '20rem';
  card.style.zIndex = 1;
  card.innerHTML = `
    <div class="card bg-dark text-center text-white mt-3 p-4 pb-0 card-body d-flex flex-column justify-content-between" style="height:500px;">
      <div>
        <h2 class="card-title display-5" style="font-size:80px; margin-bottom:20px;">${word.chinese}</h2>
        <p class="card-text">Pinyin : ${word.pinyin || ''}</p>
        <p class="card-text">English : ${word.english || ''}</p>
        <p class="card-text" style="color: rgba(255,255,255,0.6);">${word.description || ''}</p>
      </div>
      <a href="#" class="btn btn-link text-white edit-btn">✏️ Edit</a>
    </div>
  `;
  card.querySelector('.edit-btn').onclick = () => openEdit(word);
  return card;
}

function showCard() {
  if (!words.length) return;
  const word = words[idx];
  if (!word) return;
  cardContainer.innerHTML = '';
  const newCard = createCardElement(word);
  cardContainer.appendChild(newCard);
}

// Navigation
prevBtn.onclick = ()=>{ idx=(idx-1+words.length)%words.length; showCard(); toggleView('card'); };
nextBtn.onclick = ()=>{ idx=(idx+1)%words.length; showCard(); toggleView('card'); };
window.addEventListener('keydown',e=>{
  if(e.key==='ArrowLeft') prevBtn.click();
  else if(e.key==='ArrowRight') nextBtn.click();
});

// List view
function showList() {
  listBody.innerHTML = '';
  words.forEach((word,i)=>{
    const row=document.createElement('tr');
    row.innerHTML = `<td>${word.chinese}</td><td>${word.pinyin||''}</td><td>${word.english||''}</td>`;
    row.onclick = ()=>{
      idx=i;
      showCard();
      toggleView('card');
    };
    listBody.appendChild(row);
  });
}

function toggleView(view){
  if(view==='list'){
    listContainer.classList.remove('hidden'); listContainer.classList.add('visible');
    cardContainer.classList.remove('visible'); cardContainer.classList.add('hidden');
    prevBtn.style.display = 'none';
    nextBtn.style.display = 'none';
  } else {
    cardContainer.classList.remove('hidden'); cardContainer.classList.add('visible');
    listContainer.classList.remove('visible'); listContainer.classList.add('hidden');
    prevBtn.style.display = 'inline-block';
    nextBtn.style.display = 'inline-block';
  }
}


// Scroll pour passer de carte à liste
window.addEventListener('wheel', (e)=>{
  if(e.deltaY > 30 && cardContainer.classList.contains('visible')) toggleView('list');
  else if(e.deltaY < -30 && listContainer.classList.contains('visible')) toggleView('card');
});


cardContainer.addEventListener('touchstart', e => {
  touchStartY = e.touches[0].clientY;
});

cardContainer.addEventListener('touchend', e => {
  const touchEndY = e.changedTouches[0].clientY;
  const deltaY = touchEndY - touchStartY;
  if(Math.abs(deltaY) > 30){ // seuil de swipe
    toggleView('list');
  }
});

// Modal
function openEdit(word){
  editId.value = word.id;
  editChinese.value = word.chinese;
  editPinyin.value = word.pinyin||'';
  editEnglish.value = word.english||'';
  editDescription.value = word.description||'';
  const modal = new bootstrap.Modal(editModal);
  modal.show();
}

// Edit submit
editForm.onsubmit = async (e)=>{
  e.preventDefault();
  const payload={
    chinese: editChinese.value,
    pinyin: editPinyin.value,
    english: editEnglish.value,
    description: editDescription.value
  };
  try{
    await fetch(`/update/${editId.value}`,{
      method:'PUT',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(payload)
    });
    words[idx]={...words[idx], ...payload};
    showCard();
    showList();
  }catch(err){alert("Update failed");}
  const bsModal = bootstrap.Modal.getInstance(editModal);
  if(bsModal) bsModal.hide();
};

loadWords();
