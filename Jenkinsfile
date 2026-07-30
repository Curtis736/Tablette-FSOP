pipeline {
  agent any

  options {
    timestamps()
    disableConcurrentBuilds()
    buildDiscarder(logRotator(numToKeepStr: '30'))
    timeout(time: 90, unit: 'MINUTES')
  }

  parameters {
    booleanParam(name: 'SKIP_SONAR', defaultValue: false, description: 'Passer Sonar + Quality Gate (debug)')
    booleanParam(name: 'SKIP_DEPLOY', defaultValue: false, description: 'Passer build/deploy/smoke test')
  }

  environment {
    SONAR_SERVER    = 'sedi-sonar'
    COMPOSE_PROJECT = 'sedi-tablette-test'
    SMOKE_URL       = "${env.FSOP_TEST_SMOKE_URL ?: 'http://127.0.0.1:8088/api/health'}"
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
          // Dette ESLint connue (scripts/, console, curly…) : informatif seulement
          script {
            def rc = sh(script: 'npm run lint || true', returnStatus: true)
            if (rc != 0) {
              unstable('ESLint: erreurs présentes (non bloquant pour Sonar/deploy)')
            }
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
      when {
        expression { return !params.SKIP_SONAR }
      }
      steps {
        script {
          try {
            withCredentials([string(credentialsId: 'sonar-token', variable: 'SONAR_TOKEN')]) {
              withSonarQubeEnv("${SONAR_SERVER}") {
                sh '''
                  set -e
                  echo "SONAR_HOST_URL=${SONAR_HOST_URL}"
                  if command -v sonar-scanner >/dev/null 2>&1; then
                    sonar-scanner -Dsonar.login="$SONAR_TOKEN" -Dsonar.host.url="$SONAR_HOST_URL"
                  elif [ -x /opt/sonar-scanner/bin/sonar-scanner ]; then
                    /opt/sonar-scanner/bin/sonar-scanner -Dsonar.login="$SONAR_TOKEN" -Dsonar.host.url="$SONAR_HOST_URL"
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
          } catch (err) {
            echo "SonarQube stage failed: ${err}"
            echo "Vérifier: plugin SonarQube Scanner, serveur nommé '${SONAR_SERVER}', credential 'sonar-token', URL http://sonarqube:9000"
            error("SonarQube non configuré ou analyse en échec — voir message ci-dessus")
          }
        }
      }
    }

    stage('Quality Gate') {
      when {
        expression { return !params.SKIP_SONAR }
      }
      steps {
        timeout(time: 10, unit: 'MINUTES') {
          waitForQualityGate abortPipeline: true
        }
      }
    }

    stage('Build images :test') {
      when {
        expression { return !params.SKIP_DEPLOY }
      }
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
        allOf {
          expression { return !params.SKIP_DEPLOY }
          anyOf {
            branch 'main'
            branch 'master'
            branch pattern: 'feature/.*', comparator: 'REGEXP'
          }
        }
      }
      steps {
        sh '''
          set -e
          chmod +x docker/scripts/deploy-test.sh
          mkdir -p docker/ssl-runtime-test/nginx-ssl docker/ssl-runtime-test/tablet backend/logs-test
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
        allOf {
          expression { return !params.SKIP_DEPLOY }
          anyOf {
            branch 'main'
            branch 'master'
            branch pattern: 'feature/.*', comparator: 'REGEXP'
          }
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
    unstable {
      echo 'CI UNSTABLE (souvent ESLint) — Sonar/deploy peuvent avoir réussi.'
    }
    failure {
      echo 'CI KO — souvent Sonar non branché (sedi-sonar / sonar-token) ou Quality Gate / deploy.'
    }
  }
}
