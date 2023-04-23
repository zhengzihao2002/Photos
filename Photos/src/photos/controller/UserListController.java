package photos.controller;

import javafx.fxml.FXML;
import javafx.fxml.FXMLLoader;
import javafx.scene.Scene;
import javafx.scene.control.Alert;
import javafx.scene.control.Alert.AlertType;
import javafx.scene.control.Button;
import javafx.scene.control.ButtonType;
import javafx.scene.control.Label;
import javafx.scene.control.ListView;
import javafx.scene.layout.Pane;
import javafx.stage.Stage;
import photos.utility.User;

import java.io.*;
import java.util.ArrayList;
import java.util.Optional;

import photos.utility.Privacy;
import photos.utility.SceneLoader;


/**

The UserListController class represents a controller for the user list screen.
It is responsible for loading the list of users and displaying them on the screen.
It also allows the user to go back to the previous screen.
@author Zihao Zheng, Yiming Huang
@version 1.0
@since 2023-04-13
*/

public class UserListController implements Serializable{
	
	private static final long serialVersionUID = 1L;

	/**The refernece to the main stage of the program*/
	Stage mainStage;
	
	/**Arraylist of all existing users*/
	@FXML ListView<String> listOfUsers;
			
	/**
	 * Method to go back to the previous screen when the back button is clicked.
	 * 
	 * @throws IOException If there is an error loading the FXML file.
	 */
	public void back() throws IOException {
		SceneLoader.loadFXML("/photos/view/Admin.fxml", AdminController.class,Pane.class,mainStage);
	}
	
	/**
	 * Method to set the main stage and load the users on the screen.
	 * 
	 * @param stage The main stage of the application.
	 * @throws IOException If there is an error loading the users.
	 */
	public void setMainStage(Stage stage) throws IOException{
		mainStage = stage;	
		loadUsers();
	}
	
	/**
	 * Method to load the users from the Privacy class and add them to the list view.
	 */
	public void loadUsers() {
		ArrayList<User> userList = Privacy.users; 
		
		for (int i = 0; i < userList.size(); i++) {
			String username = Privacy.users.get(i).getUsername();
			listOfUsers.getItems().add(username);
		 
		}
	}
	
}