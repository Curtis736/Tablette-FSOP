pipeline {
  agent any

  options {
    timestamps()
    disableConcurrentBuilds()
    buildDiscarder(logRotator(numToKeepStr: '30'))
    timeout(time: 90, unit: 'MINUTES')
  }

  environment {
    SONAR_SERVER   = 'sedi-sonar'
    COMPOSE_PROJECT = 'sedi-tablette-test'
    SMOKE_URL      = "${env.FSOP_TEST_SMOKE_URL ?: 'http://127.0.0.1:8088/api/health'}"
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
      }
    }

    stage('Backend — install & test') {
      steps {
        dir('backend') {
          sh 'npm ci'
          sh 'npm run test:vitest:run -- --coverage || npm run test:coverage'
        }
      }
    }

    stage('Backend — lint') {
      steps {
        dir('backend') {
          // Dette ESLint éventuelle : ne bloque pas le deploy (UNSTABLE seulement)
          catchError(buildResult: 'UNSTABLE', stageResult: 'UNSTABLE') {
            sh 'npm run lint'
          }
        }
      }
    }

    stage('Frontend — install & test') {
      steps {
        dir('frontend') {
          sh 'npm ci'
          sh 'npm run test:coverage || npm run test:run'
        }
      }
    }

    stage('SonarQube') {
      steps {
        withCredentials([string(credentialsId: 'sonar-token', variable: 'SONAR_TOKEN')]) {
          withSonarQubeEnv("${SONAR_SERVER}") {
            sh '''
              set -e
              if command -v sonar-scanner >/dev/null 2>&1; then
                sonar-scanner \
                  -Dsonar.login="$SONAR_TOKEN" \
                  -Dsonar.host.url="$SONAR_HOST_URL"
              elif [ -x /opt/sonar-scanner/bin/sonar-scanner ]; then
                /opt/sonar-scanner/bin/sonar-scanner \
                  -Dsonar.login="$SONAR_TOKEN" \
                  -Dsonar.host.url="$SONAR_HOST_URL"
              else
                docker run --rm \
                  --network sedi-ci-network \
                  -e SONAR_HOST_URL="$SONAR_HOST_URL" \
                  -e SONAR_TOKEN="$SONAR_TOKEN" \
                  -v "$PWD:/usr/src" \
                  sonarsource/sonar-scanner-cli:11 \
                  -Dsonar.projectBaseDir=/usr/src
              fi
            '''
          }
        }
      }
    }

    stage('Quality Gate') {
      steps {
        timeout(time: 10, unit: 'MINUTES') {
          waitForQualityGate abortPipeline: true
        }
      }
    }

    stage('Build images :test') {
      steps {
        sh '''
          set -e
          docker build -t docker-sedi-backend:test -f docker/Dockerfile.backend .
          docker build -t docker-sedi-frontend:test -f docker/Dockerfile.frontend .
        '''
      }
    }

    stage('Deploy test') {
      when {
        anyOf {
          branch 'main'
          branch 'master'
          branch pattern: 'feature/.*', comparator: 'REGEXP'
        }
      }
      steps {
        sh '''
          set -e
          chmod +x docker/scripts/deploy-test.sh
          mkdir -p docker/ssl-runtime-test/nginx-ssl docker/ssl-runtime-test/tablet backend/logs-test
          # Si certificats test absents, réutiliser ceux de ssl-runtime prod locaux (hôte test uniquement)
          if [ ! -f docker/ssl-runtime-test/nginx-ssl/fullchain.pem ] && [ -d docker/ssl-runtime/nginx-ssl ]; then
            cp -a docker/ssl-runtime/nginx-ssl/. docker/ssl-runtime-test/nginx-ssl/ 2>/dev/null || true
            cp -a docker/ssl-runtime/tablet/. docker/ssl-runtime-test/tablet/ 2>/dev/null || true
          fi
          SKIP_BUILD=1 SMOKE_URL="$SMOKE_URL" ./docker/scripts/deploy-test.sh
        '''
      }
    }

    stage('Smoke') {
      when {
        anyOf {
          branch 'main'
          branch 'master'
          branch pattern: 'feature/.*', comparator: 'REGEXP'
        }
      }
      steps {
        sh '''
          set -e
          echo "Smoke $SMOKE_URL"
          curl -fsS --max-time 15 "$SMOKE_URL" || \
            docker exec sedi-tablette-test-backend curl -fsS --max-time 10 http://localhost:3001/api/health
        '''
      }
    }
  }

  post {
    always {
      archiveArtifacts artifacts: 'backend/coverage/**,frontend/coverage/**,backend/eslint-report.json', allowEmptyArchive: true
    }
    success {
      echo 'CI OK — env test déployé (si branche éligible). Prod non touchée.'
    }
    failure {
      echo 'CI KO — aucun déploiement test (ou smoke échoué).'
    }
  }
}
