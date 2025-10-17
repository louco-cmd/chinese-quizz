// 📍 Après la fin d'un quiz, ajoute cette fonction
async function saveQuizResults(score, totalQuestions, quizType, wordsUsed) {
  try {
    const response = await fetch('/api/quiz/save', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        score: score,
        total_questions: totalQuestions,
        quiz_type: quizType,
        words_used: wordsUsed // Optionnel: liste des mots utilisés
      })
    });
    
    const data = await response.json();
    
    if (data.success) {
      console.log('✅ Quiz sauvegardé:', data.message);
    } else {
      console.warn('⚠️ Quiz non sauvegardé:', data.error);
    }
    
  } catch (error) {
    console.error('❌ Erreur sauvegarde quiz:', error);
  }
}

// 📍 Exemple d'utilisation à la fin de ton quiz
function endQuiz(correctAnswers, totalQuestions, quizType, wordsArray) {
  const score = correctAnswers;
  
  // Affiche les résultats (ton code existant)
  showQuizResults(score, totalQuestions);
  
  // 📍 SAUVEGARDE NOUVELLE
  saveQuizResults(score, totalQuestions, quizType, wordsArray);
}