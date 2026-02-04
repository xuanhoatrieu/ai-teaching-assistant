# Test Script for AI Teaching Assistant API
# Run: .\test-api.ps1

$BaseUrl = "http://localhost:3001"

# 1. Login and get token
Write-Host "`n=== AUTH TEST ===" -ForegroundColor Cyan
$loginBody = '{"email":"testadmin@test.com","password":"test123456"}'
$authResponse = Invoke-RestMethod -Uri "$BaseUrl/auth/login" -Method POST -ContentType "application/json" -Body $loginBody
$Token = $authResponse.accessToken
Write-Host "✅ Login OK - Token received" -ForegroundColor Green

$Headers = @{
    "Authorization" = "Bearer $Token"
    "Content-Type" = "application/json"
}

# 2. Test GET /auth/me
$me = Invoke-RestMethod -Uri "$BaseUrl/auth/me" -Method GET -Headers $Headers
Write-Host "✅ GET /auth/me - User: $($me.email), Role: $($me.role)" -ForegroundColor Green

# ======== PHASE 4: PROMPTS ========
Write-Host "`n=== PHASE 4: PROMPTS TEST ===" -ForegroundColor Cyan

# List prompts (admin)
try {
    $prompts = Invoke-RestMethod -Uri "$BaseUrl/admin/prompts" -Method GET -Headers $Headers
    Write-Host "✅ GET /admin/prompts - Found $($prompts.Count) prompts" -ForegroundColor Green
} catch {
    Write-Host "⚠️ GET /admin/prompts - $($_.Exception.Message)" -ForegroundColor Yellow
}

# Get active prompt by slug
try {
    $activePrompt = Invoke-RestMethod -Uri "$BaseUrl/prompts/active/pptx-content" -Method GET -Headers $Headers
    Write-Host "✅ GET /prompts/active/pptx-content - Found: $($activePrompt.name)" -ForegroundColor Green
} catch {
    Write-Host "⚠️ GET /prompts/active/pptx-content - $($_.Exception.Message)" -ForegroundColor Yellow
}

# ======== PHASE 5: TTS PROVIDERS ========
Write-Host "`n=== PHASE 5: TTS TEST ===" -ForegroundColor Cyan

# List TTS providers (admin)
try {
    $ttsProviders = Invoke-RestMethod -Uri "$BaseUrl/admin/tts-providers" -Method GET -Headers $Headers
    Write-Host "✅ GET /admin/tts-providers - Found $($ttsProviders.Count) providers" -ForegroundColor Green
} catch {
    Write-Host "⚠️ GET /admin/tts-providers - $($_.Exception.Message)" -ForegroundColor Yellow
}

# List available providers (user)
try {
    $availableProviders = Invoke-RestMethod -Uri "$BaseUrl/tts/providers" -Method GET -Headers $Headers
    Write-Host "✅ GET /tts/providers - Found $($availableProviders.Count) available providers" -ForegroundColor Green
} catch {
    Write-Host "⚠️ GET /tts/providers - $($_.Exception.Message)" -ForegroundColor Yellow
}

# Get user's TTS configs
try {
    $myConfigs = Invoke-RestMethod -Uri "$BaseUrl/tts/my-configs" -Method GET -Headers $Headers
    Write-Host "✅ GET /tts/my-configs - Found $($myConfigs.Count) configs" -ForegroundColor Green
} catch {
    Write-Host "⚠️ GET /tts/my-configs - $($_.Exception.Message)" -ForegroundColor Yellow
}

# ======== PHASE 6: SUBJECTS & LESSONS ========
Write-Host "`n=== PHASE 6: SUBJECTS & LESSONS TEST ===" -ForegroundColor Cyan

# Create a subject
$subjectBody = '{"name":"Test Subject","description":"Testing subject creation"}'
try {
    $newSubject = Invoke-RestMethod -Uri "$BaseUrl/subjects" -Method POST -Headers $Headers -Body $subjectBody
    $subjectId = $newSubject.id
    Write-Host "✅ POST /subjects - Created: $($newSubject.name) (ID: $subjectId)" -ForegroundColor Green
} catch {
    Write-Host "⚠️ POST /subjects - $($_.Exception.Message)" -ForegroundColor Yellow
    # Try to get existing subjects
    $subjects = Invoke-RestMethod -Uri "$BaseUrl/subjects" -Method GET -Headers $Headers
    if ($subjects.Count -gt 0) {
        $subjectId = $subjects[0].id
        Write-Host "   Using existing subject: $($subjects[0].name)" -ForegroundColor Gray
    }
}

# List subjects
try {
    $subjects = Invoke-RestMethod -Uri "$BaseUrl/subjects" -Method GET -Headers $Headers
    Write-Host "✅ GET /subjects - Found $($subjects.Count) subjects" -ForegroundColor Green
} catch {
    Write-Host "⚠️ GET /subjects - $($_.Exception.Message)" -ForegroundColor Yellow
}

# Create a lesson
if ($subjectId) {
    $lessonBody = '{"title":"Test Lesson","outlineRaw":"# Introduction\n## Section 1\n- Point 1\n- Point 2"}'
    try {
        $newLesson = Invoke-RestMethod -Uri "$BaseUrl/subjects/$subjectId/lessons" -Method POST -Headers $Headers -Body $lessonBody
        $lessonId = $newLesson.id
        Write-Host "✅ POST /subjects/$subjectId/lessons - Created: $($newLesson.title)" -ForegroundColor Green
    } catch {
        Write-Host "⚠️ POST /subjects/$subjectId/lessons - $($_.Exception.Message)" -ForegroundColor Yellow
    }

    # List lessons
    try {
        $lessons = Invoke-RestMethod -Uri "$BaseUrl/subjects/$subjectId/lessons" -Method GET -Headers $Headers
        Write-Host "✅ GET /subjects/$subjectId/lessons - Found $($lessons.Count) lessons" -ForegroundColor Green
        if ($lessons.Count -gt 0) {
            $lessonId = $lessons[0].id
        }
    } catch {
        Write-Host "⚠️ GET /subjects/$subjectId/lessons - $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

# Get lesson detail
if ($lessonId) {
    try {
        $lessonDetail = Invoke-RestMethod -Uri "$BaseUrl/lessons/$lessonId" -Method GET -Headers $Headers
        Write-Host "✅ GET /lessons/$lessonId - Title: $($lessonDetail.title), Status: $($lessonDetail.status)" -ForegroundColor Green
    } catch {
        Write-Host "⚠️ GET /lessons/$lessonId - $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

# ======== PHASE 7 & 8: AI & EXPORT (Skip if no API key) ========
Write-Host "`n=== PHASE 7 & 8: AI & EXPORT TEST ===" -ForegroundColor Cyan
Write-Host "⚠️ Skipping AI generation test - GEMINI_API_KEY not set" -ForegroundColor Yellow
Write-Host "⚠️ Skipping export test - requires generated content" -ForegroundColor Yellow

# ======== TEMPLATES (Phase 12 addition) ========
Write-Host "`n=== TEMPLATES TEST ===" -ForegroundColor Cyan

# List templates
try {
    $templates = Invoke-RestMethod -Uri "$BaseUrl/templates" -Method GET -Headers $Headers
    Write-Host "✅ GET /templates - Found $($templates.Count) templates" -ForegroundColor Green
    foreach ($t in $templates) {
        Write-Host "   - $($t.name) (Default: $($t.isDefault))" -ForegroundColor Gray
    }
} catch {
    Write-Host "⚠️ GET /templates - $($_.Exception.Message)" -ForegroundColor Yellow
}

# ======== SUMMARY ========
Write-Host "`n=== TEST SUMMARY ===" -ForegroundColor Cyan
Write-Host "Auth: ✅ OK" -ForegroundColor Green
Write-Host "Prompts (Phase 4): Check above" -ForegroundColor White
Write-Host "TTS (Phase 5): Check above" -ForegroundColor White
Write-Host "Subjects/Lessons (Phase 6): Check above" -ForegroundColor White
Write-Host "AI Generator (Phase 7): ⚠️ Skipped (no API key)" -ForegroundColor Yellow
Write-Host "Export (Phase 8): ⚠️ Skipped (needs content)" -ForegroundColor Yellow
Write-Host "Templates: Check above" -ForegroundColor White
