// 📍 Après la fin d'un quiz, ajoute cette fonction
async function saveQuizResults(score, totalQuestions, quizType, results) {
  try {
    console.log('📤 Envoi des résultats au serveur:', {
      score,
      totalQuestions,
      quizType,
      results: results.map(r => ({ mot_id: r.mot_id, correct: r.correct }))
    });
    
    const response = await fetch('/api/quiz/save', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        score: score,
        total_questions: totalQuestions,
        quiz_type: quizType,
        results: results
      })
    });
    
    const data = await response.json();
    console.log('📥 Réponse du serveur:', data);
    
    if (data.success) {
      console.log('✅ Quiz sauvegardé avec scores détaillés');
    } else {
      console.warn('⚠️ Quiz non sauvegardé:', data.error);
    }
    
  } catch (error) {
    console.error('❌ Erreur sauvegarde quiz:', error);
  }
}

// 📍 Exemple d'utilisation à la fin de ton quiz
function endQuiz() {
  quizQuestion.textContent = '🎉 Quiz terminé !';
  quizResult.textContent = `Score final: ${correctCount}/${quizWords.length}`;
  quizResult.className = "mb-3 text-center text-success fw-bold fs-4";
  checkBtn.style.display = 'none';
  quizFields.innerHTML = '';
  
  const wordsArray = quizWords.map(word => word.pinyin);
  
  // 🔥 CORRECTION : Envoyer quizResults au lieu de wordsArray
  console.log('🏁 Envoi de quizResults:', quizResults);
  saveQuizResults(correctCount, quizWords.length, 'pinyin', quizResults);
  
  setTimeout(() => { 
    window.location.href = '/dashboard'; 
  }, 3000);
}