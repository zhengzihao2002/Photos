package photos.controller;



import javafx.event.EventHandler;
import javafx.fxml.FXML;
import javafx.scene.control.*;
import javafx.scene.input.KeyCode;
import javafx.scene.input.KeyEvent;
import javafx.scene.input.MouseButton;
import javafx.scene.input.MouseEvent;
import javafx.scene.layout.Pane;
import javafx.stage.Stage;

import java.io.*;
import java.lang.reflect.InvocationTargetException;
import java.util.ArrayList;

import photos.utility.*;


/**
The login controller class is the controller for the login.fxml in the view package. it provides the basic functionality the actions in the login state, which is the state the user enters after starting the program
@since 2023-04-13
@author Zihao Zheng
@author Yiming Huang
*/
public class LoginController implements Serializable{
	
	private static final long serialVersionUID = 1L;
	
	/**
	 * The debug value. if set to true, then it will print information such as these to the terminal
	 * 1) Total Users
	 * 2) Each User's user name and password, and type
	 * 3) Each Album the user has, and the photos in the album
	 * 4) Each photo in the folders that exists under local
	 * 5) The deletion of Orphan photos (photo that no user owns)
	 * */
	public static boolean debug = false;

	/** The refernece to the current stage the program runs on */
	Stage mainStage;
	
	EventHandler<KeyEvent> eventHandler = null;
	
	@FXML Label title;
	@FXML Label warning;
	@FXML TextField unameText;
	@FXML TextField passwordText;
	@FXML CheckBox remUsername;
	@FXML Button login;
	
	/**
	Sets the main stage for the application and performs various initialization tasks.
	@param stage the main stage of the application
	@throws IOException if an I/O error occurs
	*/
	public void setMainStage(Stage stage) throws IOException{		
		// Keep the copy of "The Stage"
		mainStage = stage;
		
		
		// Check remembered usernames
		if(Privacy.savedUsername!=null) {
			unameText.setText(Privacy.savedUsername);
			remUsername.setSelected(true);
		}
		
		// Add the key pressed listener to the stage
		eventHandler = new EventHandler<KeyEvent>() {
		    public void handle(KeyEvent keyEvent) {
		        if (keyEvent.getCode() == KeyCode.ENTER) {
		            // simulate a click on the login button
		            MouseEvent mouseEvent = new MouseEvent(MouseEvent.MOUSE_CLICKED, 0, 0, 0, 0, MouseButton.PRIMARY, 1, true, true, true, true, true, true, true, true, true, true, null);
		            login.fireEvent(mouseEvent);
		        }
		        else {
//		            System.out.println("Key pressed: " + keyEvent.getCode());
		        }
		    }
		};
		stage.addEventFilter(KeyEvent.KEY_PRESSED, eventHandler);


		// Print out all the users
		Privacy.print();
		// Print out all the photos in the local storage and remove extraneous photos
		Photo.getAllPhotos();

	}
	
	/**
	Handles the login button click event and performs the necessary actions, such as checking the
	validity of the user's credentials, saving the credentials if the corresponding option is selected,
	and switching to the desired stage/scene.
	@throws IOException if an I/O error occurs
	@throws NoSuchMethodException if the specified method cannot be found
	@throws SecurityException if a security violation occurs
	@throws IllegalAccessException if the method cannot be accessed due to restrictions
	@throws InvocationTargetException if the method cannot be invoked
	*/
	public void loginHandler() throws IOException, NoSuchMethodException, SecurityException, IllegalAccessException, InvocationTargetException {
		warning.setVisible(false);
		// Check if username exists
		if(unameText.getText().isBlank()||unameText.getText().isEmpty()) {
			// Give warning
			warning.setVisible(true);
		}else if(checkPassword(unameText.getText(),passwordText.getText())){
			// The password is correct
			// Save the password / user name, if selected the option
			saveCredentials();
			
			// Switch to the desired stage/scene
			switchScene();
		}		
		warning.setVisible(true);
	}
	
	/**
	Checks if the specified username and password match the credentials of any user in the privacy database.
	@param username the username to check
	@param password the password to check
	@return true if the specified username and password match the credentials of a user in the privacy database, false otherwise
	*/
	public boolean checkPassword(String username, String password) {
	    for (User user : Privacy.users) {
	        if (user.getUsername().equals(username) && user.getPassword().equals(password)) {
	            return true; // username and password match
	        }
	    }
	    return false; // username not found or password doesn't match
	}
	
	
	/**
	Switches to the desired stage/scene depending on the user's credentials.
	@throws IOException if an I/O error occurs
	@throws NoSuchMethodException if the specified method cannot be found
	@throws SecurityException if a security violation occurs
	@throws IllegalAccessException if the method cannot be accessed due to restrictions
	@throws InvocationTargetException if the method cannot be invoked
	*/
	public void switchScene() throws IOException, NoSuchMethodException, SecurityException, IllegalAccessException, InvocationTargetException {
		User u = null;
		for (User user : Privacy.users) {
	        if (user.getUsername().equals(unameText.getText())) {
	        	u = user;
	        	Privacy.currentUser = user;
	            break; 
	        }
	    }
		if(u!=null && u.getType().equals("Administrator")) {
			// To remove the event filter:
			mainStage.removeEventFilter(KeyEvent.KEY_PRESSED, eventHandler);
			AdminController.admin = u;
			SceneLoader.loadFXML("/photos/view/Admin.fxml", AdminController.class,Pane.class,mainStage);
		}else if(u!=null && u.getType().equals("Non-admin")) {
			// To remove the event filter:
			mainStage.removeEventFilter(KeyEvent.KEY_PRESSED, eventHandler);
			nonAdminController.currUser = u;
			SceneLoader.loadFXML("/photos/view/nonAdmin.fxml", nonAdminController.class,Pane.class,mainStage);
		}
	}
	

	/**
	Saves the user's credentials if the "remember username" option is selected.
	*/
	public void saveCredentials() {
		if(remUsername.isSelected() && !unameText.getText().isBlank() && !unameText.getText().isEmpty()) {
			Privacy.savedUsername = unameText.getText();
		}
	}
	
	
}