/**
 * Strategies Page - Main Application
 */

import { initSidebar } from '../shared/sidebar.js'

class StrategiesApp {
  constructor() {
    this.currentSection = 'signal-sources'
    this.init()
  }

  async init() {
    // Initialize sidebar navigation
    await initSidebar({ activePage: 'strategies' })

    // Bind tab navigation
    this.bindEvents()
  }

  bindEvents() {
    // Tab navigation
    document.querySelectorAll('.nav-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        const section = e.target.dataset.section
        this.switchSection(section)
      })
    })
  }

  switchSection(sectionId) {
    // Update active tab
    document.querySelectorAll('.nav-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.section === sectionId)
    })

    // Show/hide sections
    document.querySelectorAll('.content-section').forEach(section => {
      section.style.display = section.id === sectionId ? 'block' : 'none'
    })

    this.currentSection = sectionId
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  window.strategiesApp = new StrategiesApp()
})
