// Module-scoped variables for modal elements, initially null
let modal = null;
let modalDynamicContent = null;
let closeButton = null;
let isModalInitialized = false;
let modalPlaceholder = null;
let activeCloseButton = null; // Store the active close button to remove its event listener later

/**
 * Initializes modal elements and attaches event listeners.
 * Should be called before trying to use the modal elements.
 */
function initializeGenericModal() {
    if (isModalInitialized) return;

    modal = document.getElementById('genericModal');

    if (!modal) {
        return; // Stop initialization if the main modal element isn't found
    }

    modalDynamicContent = document.getElementById('modalDynamicContent');
    if (!modalDynamicContent) {
        // Log a warning but don't necessarily stop, as modal might be used without dynamic content
    }

    closeButton = modal.querySelector('.close-button');
    if (closeButton) {
        closeButton.addEventListener('click', hideGenericModal);
    }

    // Close modal if user clicks outside the modal content
    window.addEventListener('click', (event) => {
        // Check `modal` again directly in case it was dynamically added/removed
        const currentModalElement = document.getElementById('genericModal');
        if (event.target === currentModalElement) {
            hideGenericModal();
        }
    });

    isModalInitialized = true;
}

/**
 * Shows the generic modal with specified title and message.
 * @param {object} content - Object containing title and message.
 * @param {string} content.title - The title for the modal.
 * @param {string} content.message - The HTML message content for the modal.
 */
export function showGenericModal({ title, message }) {
    initializeGenericModal(); // Ensure elements are looked up and listeners attached

    if (!modal) {
        return;
    }

    if (modalDynamicContent) {
        modalDynamicContent.innerHTML = ''; // Clear previous content

        const titleElement = document.createElement('h2');
        titleElement.textContent = title;
        modalDynamicContent.appendChild(titleElement);

        const messageElement = document.createElement('p');
        messageElement.innerHTML = message; // Use innerHTML to allow for HTML content
        modalDynamicContent.appendChild(messageElement);
    }
}

/**
 * Hides the generic modal.
 */
export function hideGenericModal() {
    // No need to call initializeModal() here if we only operate on `modal`
    // and assume it's found by `showGenericModal` first or CSS handles initial state.
    // However, to be safe, if hide could be called independently:
    if (!isModalInitialized) {
        // Attempt to get the modal element if not already done
        modal = document.getElementById('genericModal');
    }

    if (modal) {
        modal.style.display = 'none';
    }
    // If modal is not found, there's nothing to hide.
}

/**
 * Fetches the HTML content for the generic modal.
 * @returns {Promise<string>} A promise that resolves with the modal HTML, or an empty string on failure.
 */
async function fetchModalHtml() {
    try {
        const response = await fetch("/generic-modal.html");
        if (!response.ok) {
            return "";
        }
        const htmlText = await response.text();
        return htmlText;
    } catch (error) {
        return "";
    }
}

/**
 * Opens the generic modal and populates it with the given title and content.
 * This version dynamically loads content from generic-modal.html.
 * @param {string} title - The title for the modal.
 * @param {string} content - The content for the modal body. Can be plain text or HTML.
 * @param {object} [options={}] - Options for content handling.
 * @param {boolean} [options.isHtml=false] - Whether the content string should be treated as HTML.
 */
export async function openGenericModal(title, content, { isHtml = false } = {}) {
    if (!modalPlaceholder) {
        modalPlaceholder = document.getElementById("genericModal");
        if (!modalPlaceholder) {
            return;
        }
    }

    const modalHtml = await fetchModalHtml();
    if (!modalHtml) {
        return;
    }

    modalPlaceholder.innerHTML = modalHtml;

    const injectedModalElement = modalPlaceholder.querySelector(":scope > div.modal");

    if (!injectedModalElement) {
        modalPlaceholder.style.display = "none";
        modalPlaceholder.innerHTML = "";
        return;
    }

    if (activeCloseButton) {
        activeCloseButton.removeEventListener("click", closeGenericModal);
        activeCloseButton = null;
    }

    activeCloseButton = injectedModalElement.querySelector(".close-button");
    const dynamicContentContainer = injectedModalElement.querySelector("#modalDynamicContent");

    if (dynamicContentContainer) {
        const titleElement = dynamicContentContainer.querySelector("h2");
        let bodyElement = dynamicContentContainer.querySelector("p");

        if (titleElement) {
            titleElement.textContent = title;
        }

        if (!bodyElement) {
            if (titleElement) dynamicContentContainer.innerHTML = titleElement.outerHTML;
            else dynamicContentContainer.innerHTML = '';
            bodyElement = dynamicContentContainer;
        }


        if (isHtml) {
            if (bodyElement === dynamicContentContainer && titleElement) {
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = content;
                Array.from(tempDiv.childNodes).forEach(child => bodyElement.appendChild(child));
            } else {
                bodyElement.innerHTML = content;
            }
        } else {
            if (bodyElement === dynamicContentContainer && titleElement) {
                const textNode = document.createTextNode(content);
                bodyElement.appendChild(textNode);
            } else {
                bodyElement.textContent = content;
            }
        }
    }

    if (activeCloseButton) {
        activeCloseButton.addEventListener("click", closeGenericModal);
    }

    modalPlaceholder.style.display = "block";
}

/**
 * Closes the generic modal that was opened by openGenericModal.
 */
export function closeGenericModal() {
    if (modalPlaceholder) {
        modalPlaceholder.style.display = "none";
        if (activeCloseButton) {
            activeCloseButton.removeEventListener("click", closeGenericModal);
            activeCloseButton = null;
        }
        modalPlaceholder.innerHTML = "";
    }
}

// Add event listener for the Escape key to close the modal
document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' || event.key === 'Esc') {
        if (modalPlaceholder && modalPlaceholder.style.display === 'block') {
            closeGenericModal();
        }
    }
});
